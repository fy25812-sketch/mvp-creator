#!/usr/bin/env bash
#
# {{PROJECT_NAME}} — roll back to the previously deployed image tag
# Rendered by MVP Creator on {{GENERATED_AT}}.
#
# deploy/deploy.sh writes the tag that is currently live to .deployed-tag and
# moves the previous one to .deployed-tag.prev. This script swaps them back:
# it re-runs the previous image with `docker compose up -d --no-build` and then
# flips the two files, so running it twice returns you to where you started.
#
# It never rebuilds and never touches SQLite data or .env.
#
# Usage:
#   bash deploy/rollback.sh                 # roll back to .deployed-tag.prev
#   bash deploy/rollback.sh --list          # show the image tags on the server
#   bash deploy/rollback.sh --tag <tag>     # roll back to an explicit tag
#   bash deploy/rollback.sh --dry-run       # print the commands only
#
# Environment overrides: HEALTH_RETRIES, HEALTH_INTERVAL, DOCKER_SUDO, SSH_EXTRA_OPTS

set -euo pipefail

PROJECT_NAME="{{PROJECT_NAME}}"
SSH_USER="{{SSH_USER}}"
SSH_HOST="{{SSH_HOST}}"
REMOTE_DIR="{{REMOTE_DIR}}"
DOMAIN="{{DOMAIN}}"
APP_PORT="{{APP_PORT}}"
CONTAINER_NAME="{{CONTAINER_NAME}}"

SSH_TARGET="${SSH_USER}@${SSH_HOST}"
HEALTH_URL="http://127.0.0.1:${APP_PORT}/healthz"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-2}"
DOCKER_SUDO="${DOCKER_SUDO:-0}"

DRY_RUN=0
LIST_ONLY=0
TAG_OVERRIDE=""
SSH_OPTS=(-o ConnectTimeout=10 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new)

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

if [ "$DOCKER_SUDO" = "1" ]; then
    DOCKER="sudo docker"
else
    DOCKER="docker"
fi

usage() {
    cat <<'USAGE'
{{PROJECT_NAME}} — roll the deployment back to a previous image tag

Usage: bash deploy/rollback.sh [options]

Options:
  --list           list the image tags available on the server and exit
  --tag <tag>      roll back to an explicit tag instead of .deployed-tag.prev
  --dry-run        print every command that would run; execute nothing
  -h, --help       show this help
USAGE
}

remote_exec() {
    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] ssh %s \\\n' "$SSH_TARGET"
        printf '%s\n' "$1" | sed 's/^/          /'
        return 0
    fi
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$1"
}

remote_read() {
    # $1 — file name inside the remote deploy directory.
    ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cat '${REMOTE_DIR}/$1' 2>/dev/null" \
        | tr -d '\r' | head -n 1
}

remote_probe() {
    printf 'if command -v curl >/dev/null 2>&1; then curl -fsS --max-time 5 %s; elif command -v wget >/dev/null 2>&1; then wget -q -O - --timeout=5 %s; else echo "no curl or wget on the server" >&2; exit 127; fi' \
        "$HEALTH_URL" "$HEALTH_URL"
}

main() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --dry-run) DRY_RUN=1 ;;
            --list)    LIST_ONLY=1 ;;
            --tag)     shift; TAG_OVERRIDE="${1:-}" ;;
            --tag=*)   TAG_OVERRIDE="${1#--tag=}" ;;
            -h|--help) usage; exit 0 ;;
            *)         die "unknown argument: $1 (try --help)" ;;
        esac
        shift
    done

    command -v ssh >/dev/null 2>&1 || die "ssh is not on PATH"

    if [ "$LIST_ONLY" -eq 1 ]; then
        log "image tags on ${SSH_HOST}"
        remote_exec "${DOCKER} images '${CONTAINER_NAME}'"
        exit 0
    fi

    local current_tag="" target_tag=""
    if [ -n "$TAG_OVERRIDE" ]; then
        target_tag="$TAG_OVERRIDE"
    elif [ "$DRY_RUN" -eq 1 ]; then
        target_tag="<contents of ${REMOTE_DIR}/.deployed-tag.prev>"
    else
        current_tag="$(remote_read .deployed-tag || true)"
        target_tag="$(remote_read .deployed-tag.prev || true)"
    fi

    if [ -z "$target_tag" ]; then
        die "no previous tag found: ${REMOTE_DIR}/.deployed-tag.prev is empty or missing. Use --list and --tag <tag>."
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
        warn "DRY RUN — nothing will be executed against ${SSH_HOST}"
    fi

    log "rolling back ${PROJECT_NAME} to ${CONTAINER_NAME}:${target_tag}"

    remote_exec "set -e
${DOCKER} image inspect '${CONTAINER_NAME}:${target_tag}' >/dev/null
cd '${REMOTE_DIR}'
IMAGE_TAG='${target_tag}' ${DOCKER} compose up -d --no-build --remove-orphans
IMAGE_TAG='${target_tag}' ${DOCKER} compose ps"

    if [ "$DRY_RUN" -eq 1 ]; then
        printf '[dry-run] ssh %s "%s"\n' "$SSH_TARGET" "$(remote_probe)"
    else
        local attempt
        for attempt in $(seq 1 "$HEALTH_RETRIES"); do
            if ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$(remote_probe)" >/dev/null 2>&1; then
                info "healthy after ${attempt} attempt(s)"
                break
            fi
            printf '    waiting for /healthz ... (%s/%s)\n' "$attempt" "$HEALTH_RETRIES"
            sleep "$HEALTH_INTERVAL"
        done
        if ! ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "$(remote_probe)" >/dev/null 2>&1; then
            warn "rollback target did not become healthy"
            ssh "${SSH_OPTS[@]}" "$SSH_TARGET" \
                "cd '${REMOTE_DIR}' && ${DOCKER} compose logs --tail=100" || true
            exit 1
        fi

        remote_exec "cd '${REMOTE_DIR}'
printf '%s\n' '${current_tag}' > .deployed-tag.prev
printf '%s\n' '${target_tag}' > .deployed-tag
echo '[remote] live tag now:' \$(cat .deployed-tag)"
    fi

    echo
    log "rolled back"
    info "url       : https://${DOMAIN}"
    info "image tag : ${target_tag}"
    if [ "$DRY_RUN" -eq 1 ]; then
        warn "dry-run: nothing was executed"
    fi
}

main "$@"
