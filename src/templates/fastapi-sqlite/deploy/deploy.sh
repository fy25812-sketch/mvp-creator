#!/usr/bin/env bash
#
# {{PROJECT_NAME}} — deploy to {{SSH_HOST}}:{{REMOTE_DIR}}
# Rendered by MVP Creator on {{GENERATED_AT}}.
#
# What it does, in order:
#   1. preflight  — local tooling (ssh/tar) + remote reachability + docker/compose
#   2. sync       — push the working tree over ssh using `tar | ssh` (no rsync
#                   dependency; the authoring machine is Windows)
#   3. build      — `docker compose build` on the server, tagged with IMAGE_TAG
#   4. up         — `docker compose up -d`
#   5. health     — poll http://127.0.0.1:{{APP_PORT}}/healthz until 200; on
#                   failure print `docker compose logs --tail=100` and exit 1
#   6. record     — write the live tag to .deployed-tag (previous one is kept in
#                   .deployed-tag.prev so deploy/rollback.sh can flip back)
#
# The app container is published on 127.0.0.1 only; host nginx terminates TLS.
# This script never touches nginx or certificates — see deploy/https.md.
#
# Usage:
#   bash deploy/deploy.sh                  # full deploy
#   bash deploy/deploy.sh --dry-run        # echo every command, change nothing
#   bash deploy/deploy.sh --skip-build     # reuse the image already on the server
#   bash deploy/deploy.sh --tag v1-notes   # override the generated image tag
#
# Environment overrides:
#   HEALTH_RETRIES=30  HEALTH_INTERVAL=2  DOCKER_SUDO=1  SSH_EXTRA_OPTS="-p 2222"
#
# Docker permissions: the script assumes {{SSH_USER}} can talk to the docker
# daemon directly. If it needs sudo, run with DOCKER_SUDO=1.

set -euo pipefail

# ---------------------------------------------------------------- config -----
PROJECT_NAME="{{PROJECT_NAME}}"
SSH_USER="{{SSH_USER}}"
SSH_HOST="{{SSH_HOST}}"
REMOTE_DIR="{{REMOTE_DIR}}"
DOMAIN="{{DOMAIN}}"
APP_PORT="{{APP_PORT}}"
CONTAINER_NAME="{{CONTAINER_NAME}}"
GENERATED_AT="{{GENERATED_AT}}"

SSH_TARGET="${SSH_USER}@${SSH_HOST}"
HEALTH_URL="http://127.0.0.1:${APP_PORT}/healthz"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
DOCKER_SUDO="${DOCKER_SUDO:-0}"

DRY_RUN=0
SKIP_BUILD=0
TAG_OVERRIDE=""
SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new)

# Everything in this list is rebuilt from source on every deploy. `data` and
# `.env` are deliberately excluded: they hold live state / server secrets and
# must survive a deploy (this is what makes re-running the script idempotent).
TAR_EXCLUDES=(
    --exclude '.git'
    --exclude '.venv'
    --exclude 'venv'
    --exclude '__pycache__'
    --exclude '*.pyc'
    --exclude '.pytest_cache'
    --exclude '.mypy_cache'
    --exclude '.ruff_cache'
    --exclude 'data'
    --exclude '.env'
    --exclude '.deployed-tag'
    --exclude '.deployed-tag.prev'
    --exclude 'node_modules'
)

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------- output -----
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
{{PROJECT_NAME}} — deploy the app container to {{SSH_HOST}}

Usage: bash deploy/deploy.sh [options]

Options:
  --dry-run        print every command that would run; execute nothing
  --skip-build     reuse the image already present on the server
  --tag <tag>      override the image tag (default: derived from the render timestamp)
  -h, --help       show this help

Environment overrides:
  HEALTH_RETRIES   default 30
  HEALTH_INTERVAL  default 2
  DOCKER_SUDO      set to 1 when the remote user needs `sudo docker`
  SSH_EXTRA_OPTS   extra flags for every ssh invocation
USAGE
}

# ---------------------------------------------------------------- helpers ----
# Docker invocation prefix on the server (DOCKER_SUDO=1 -> "sudo docker").
if [ "$DOCKER_SUDO" = "1" ]; then
    DOCKER="sudo docker"
else
    DOCKER="docker"
fi

remote_exec() {
    # $1 — a single shell snippet executed on the server.
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] ssh %s \\\n' "$SSH_TARGET"
        printf '%s\n' "$1" | sed 's/^/          /'
        return 0
    fi
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$1"
}

remote_probe() {
    # Prints the remote health-probe snippet; curl with a wget fallback.
    printf 'if command -v curl >/dev/null 2>&1; then curl -fsS --max-time 5 %s; elif command -v wget >/dev/null 2>&1; then wget -q -O - --timeout=5 %s; else echo "no curl or wget on the server" >&2; exit 127; fi' \
        "$HEALTH_URL" "$HEALTH_URL"
}

sanitize_tag() {
    printf '%s' "$1" | tr -cd '0-9A-Za-z._-' | cut -c1-120
}

# ---------------------------------------------------------------- steps ------
preflight_local() {
    log "preflight (local)"
    command -v ssh >/dev/null 2>&1 || die "ssh is not on PATH"
    command -v tar >/dev/null 2>&1 || die "tar is not on PATH"

    local name value
    for name in PROJECT_NAME SSH_USER SSH_HOST REMOTE_DIR DOMAIN APP_PORT CONTAINER_NAME; do
        value="${!name}"
        if [ -z "$value" ]; then
            die "$name is empty — was this template rendered?"
        fi
        case "$value" in
            *"{"*) die "$name still contains a placeholder: $value" ;;
        esac
    done

    if [ -f "${SRC_DIR}/.env" ] && grep -q '^ENABLE_DOCS=true' "${SRC_DIR}/.env"; then
        warn "local .env sets ENABLE_DOCS=true; the deployment baseline is false"
    fi
    info "target: ${SSH_TARGET}:${REMOTE_DIR}"
    info "image : ${CONTAINER_NAME}:${IMAGE_TAG}"
}

step_preflight_remote() {
    log "preflight (remote: ${SSH_HOST})"
    remote_exec "set -e
echo \"[remote] \$(id -un)@\$(hostname)\"
uname -srm
if ! command -v docker >/dev/null 2>&1; then
    echo 'docker is not installed on the server' >&2
    exit 1
fi
${DOCKER} compose version
mkdir -p '${REMOTE_DIR}'
echo '[remote] preflight ok'"
}

step_sync() {
    log "syncing ${SRC_DIR} -> ${SSH_TARGET}:${REMOTE_DIR}"
    local remote_cmd="mkdir -p '${REMOTE_DIR}' && tar xzf - -C '${REMOTE_DIR}'"
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] (cd %s && tar czf - %s .) | ssh %s "%s"\n' \
            "$SRC_DIR" "${TAR_EXCLUDES[*]}" "$SSH_TARGET" "$remote_cmd"
        return 0
    fi
    tar czf - "${TAR_EXCLUDES[@]}" -C "$SRC_DIR" . \
        | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$remote_cmd"
    info "code synced (data/, .env and .deployed-tag left untouched)"
}

step_prepare() {
    log "preparing runtime directory"
    remote_exec "set -e
cd '${REMOTE_DIR}'
if [ ! -f .env ]; then
    cp .env.example .env
    echo '[remote] created .env from .env.example — review ENABLE_DOCS / APP_PORT'
fi
mkdir -p data
# The container runs as uid 10001 (see Dockerfile); the bind-mounted SQLite
# directory must be writable by it. chown needs root, chmod is the fallback.
chown -R 10001:10001 data 2>/dev/null || chmod -R 0777 data 2>/dev/null || true
ls -ld data"
}

step_build() {
    log "building image ${CONTAINER_NAME}:${IMAGE_TAG}"
    remote_exec "set -e
cd '${REMOTE_DIR}'
IMAGE_TAG='${IMAGE_TAG}' ${DOCKER} compose build"
}

step_up() {
    log "starting the stack"
    remote_exec "set -e
cd '${REMOTE_DIR}'
IMAGE_TAG='${IMAGE_TAG}' ${DOCKER} compose up -d --remove-orphans
IMAGE_TAG='${IMAGE_TAG}' ${DOCKER} compose ps"
}

step_health() {
    log "waiting for ${HEALTH_URL} (up to $((HEALTH_RETRIES * HEALTH_INTERVAL))s)"
    local attempt
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] ssh %s "%s"\n' "$SSH_TARGET" "$(remote_probe)"
        return 0
    fi
    for attempt in $(seq 1 "$HEALTH_RETRIES"); do
        if ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$(remote_probe)" >/dev/null 2>&1; then
            info "healthy after ${attempt} attempt(s)"
            return 0
        fi
        printf '    waiting for /healthz ... (%s/%s)\n' "$attempt" "$HEALTH_RETRIES"
        sleep "$HEALTH_INTERVAL"
    done

    warn "health check failed after ${HEALTH_RETRIES} attempts"
    warn "last 100 log lines:"
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
        "cd '${REMOTE_DIR}' && ${DOCKER} compose logs --tail=100" || true
    exit 1
}

step_record_tag() {
    log "recording deployed tag"
    remote_exec "set -e
cd '${REMOTE_DIR}'
if [ -f .deployed-tag ]; then
    cp -f .deployed-tag .deployed-tag.prev
fi
printf '%s\n' '${IMAGE_TAG}' > .deployed-tag
echo \"[remote] live tag: \$(cat .deployed-tag)\""
}

summary() {
    echo
    log "${PROJECT_NAME} deployed"
    info "url        : https://${DOMAIN}"
    info "image tag  : ${IMAGE_TAG}"
    info "rollback   : bash deploy/rollback.sh"
    info "logs       : ssh ${SSH_TARGET} \"cd ${REMOTE_DIR} && docker compose logs --tail=100 -f\""
    if [ "$DRY_RUN" -eq 1 ]; then
        warn "dry-run: nothing was executed"
    fi
}

# ---------------------------------------------------------------- main -------
main() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --dry-run)     DRY_RUN=1 ;;
            --skip-build)  SKIP_BUILD=1 ;;
            --tag)         shift; TAG_OVERRIDE="${1:-}" ;;
            --tag=*)       TAG_OVERRIDE="${1#--tag=}" ;;
            -h|--help)     usage; exit 0 ;;
            *)             die "unknown argument: $1 (try --help)" ;;
        esac
        shift
    done

    if [ -n "$TAG_OVERRIDE" ]; then
        IMAGE_TAG="$(sanitize_tag "$TAG_OVERRIDE")"
    else
        IMAGE_TAG="$(sanitize_tag "$GENERATED_AT")"
    fi
    if [ -z "${IMAGE_TAG:-}" ]; then
        IMAGE_TAG="$(date -u +%Y%m%dT%H%M%SZ)"
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
        warn "DRY RUN — no command will be executed against ${SSH_HOST}"
    fi

    preflight_local
    step_preflight_remote
    step_sync
    step_prepare
    if [ "$SKIP_BUILD" -eq 0 ]; then
        step_build
    else
        warn "--skip-build: reusing ${CONTAINER_NAME}:${IMAGE_TAG} as-is"
    fi
    step_up
    step_health
    step_record_tag
    summary
}

main "$@"
