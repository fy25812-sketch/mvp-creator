#!/usr/bin/env bash
#
# {{PROJECT_NAME}} — first Let's Encrypt issuance and renewal for {{DOMAIN}}
# Rendered by MVP Creator on {{GENERATED_AT}}.
#
# Run this ON THE SERVER, as root:
#
#   sudo bash {{REMOTE_DIR}}/deploy/init-letsencrypt.sh
#
# Why two phases? deploy/nginx.conf references
# /etc/letsencrypt/live/{{DOMAIN}}/fullchain.pem, which does not exist before
# the first issuance — nginx would refuse to start. So this script:
#
#   phase 1  writes a temporary HTTP-only vhost for {{DOMAIN}} and reloads nginx
#            (it also proxies to the app on 127.0.0.1:{{APP_PORT}}, so the site
#            stays reachable over plain HTTP while you wait)
#   phase 2  runs certbot in Docker with the webroot plugin against
#            /.well-known/acme-challenge/
#   phase 3  copies the real deploy/nginx.conf into ${NGINX_CONF_DIR} and
#            reloads nginx, so both 80 -> 443 redirect and TLS go live
#
# Prerequisites: the DNS A record of {{DOMAIN}} must already point at this
# machine, and port 80 must be reachable from the internet. See deploy/https.md.
#
# Usage:
#   bash deploy/init-letsencrypt.sh                 # issue (or renew) the certificate
#   bash deploy/init-letsencrypt.sh --dry-run       # certbot rehearsal, no cert saved
#   bash deploy/init-letsencrypt.sh --staging       # issue a throwaway staging cert
#   bash deploy/init-letsencrypt.sh --force         # renew even if not near expiry
#   bash deploy/init-letsencrypt.sh --renew-only    # never touch nginx, just renew

set -euo pipefail

DOMAIN="{{DOMAIN}}"
CERT_EMAIL="{{CERT_EMAIL}}"
REMOTE_DIR="{{REMOTE_DIR}}"
CONTAINER_NAME="{{CONTAINER_NAME}}"
APP_PORT="{{APP_PORT}}"

CERTBOT_IMAGE="${CERTBOT_IMAGE:-certbot/certbot:latest}"
WEBROOT="/var/www/certbot"
LE_CONFIG="/etc/letsencrypt"
LE_WORK="/var/lib/letsencrypt"
LIVE_DIR="${LE_CONFIG}/live/${DOMAIN}"
NGINX_CONF_DIR="/etc/nginx/conf.d"
NGINX_CONF="${NGINX_CONF_DIR}/${CONTAINER_NAME}.conf"

STAGING=0
DRY_RUN=0
FORCE=0
RENEW_ONLY=0

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'USAGE'
{{PROJECT_NAME}} — issue or renew the TLS certificate for {{DOMAIN}}

Usage: sudo bash deploy/init-letsencrypt.sh [options]

Options:
  --dry-run      run certbot against the staging endpoint without saving a
                 certificate (safe rehearsal; the temporary HTTP-only vhost
                 stays installed, re-run without this flag to finish)
  --staging      issue a real but untrusted staging certificate (rate-limit safe)
  --force        force renewal even when the certificate is not near expiry
  --renew-only   only renew; never write an nginx config
  -h, --help     show this help
USAGE
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        die "must run as root: sudo bash deploy/init-letsencrypt.sh"
    fi
}

require_tools() {
    command -v docker >/dev/null 2>&1 || die "docker is not installed"
    if [ "$RENEW_ONLY" -eq 0 ]; then
        command -v nginx >/dev/null 2>&1 || die "nginx is not installed on the host"
    fi
}

dns_hint() {
    local resolved=""
    resolved="$(getent hosts "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -n 1 || true)"
    if [ -z "$resolved" ]; then
        warn "${DOMAIN} does not resolve yet — create the DNS A record before issuing,"
        warn "otherwise the HTTP-01 challenge fails with 'DNS problem: NXDOMAIN'."
    else
        info "${DOMAIN} resolves to ${resolved} — it must be this server's public IP."
    fi
}

reload_nginx() {
    nginx -t
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
        systemctl reload nginx
    else
        nginx -s reload
    fi
    info "nginx reloaded"
}

write_http_only_vhost() {
    mkdir -p "${NGINX_CONF_DIR}" "${WEBROOT}"
    if [ -f "${NGINX_CONF}" ]; then
        cp -f "${NGINX_CONF}" "${NGINX_CONF}.bak"
        info "backed up the current vhost to ${NGINX_CONF}.bak"
    fi

    local tmp
    tmp="$(mktemp)"
    cat > "${tmp}" <<'HTTPONLY'
# TEMPORARY HTTP-only vhost written by deploy/init-letsencrypt.sh.
# It is replaced by deploy/nginx.conf as soon as the certificate exists.
server {
    listen      80;
    listen      [::]:80;
    server_name __DOMAIN__;

    location /.well-known/acme-challenge/ {
        root         /var/www/certbot;
        default_type "text/plain";
        access_log   off;
    }

    location / {
        proxy_pass http://127.0.0.1:__APP_PORT__;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
HTTPONLY

    sed -e "s|__DOMAIN__|${DOMAIN}|g" -e "s|__APP_PORT__|${APP_PORT}|g" \
        "${tmp}" > "${NGINX_CONF}"
    rm -f "${tmp}"
    info "wrote temporary HTTP-only vhost ${NGINX_CONF}"
}

install_tls_vhost() {
    local source_conf="${REMOTE_DIR}/deploy/nginx.conf"
    if [ ! -f "${source_conf}" ]; then
        die "${source_conf} not found — deploy the repository first (bash deploy/deploy.sh)"
    fi
    cp -f "${source_conf}" "${NGINX_CONF}"
    chmod 0644 "${NGINX_CONF}"
    info "installed ${NGINX_CONF} from ${source_conf}"
}

certbot_issue() {
    local extra=()
    if [ "${STAGING}" -eq 1 ]; then extra+=(--staging); fi
    if [ "${DRY_RUN}" -eq 1 ]; then extra+=(--dry-run); fi

    docker run --rm \
        -v "${LE_CONFIG}:${LE_CONFIG}" \
        -v "${LE_WORK}:${LE_WORK}" \
        -v "${WEBROOT}:${WEBROOT}" \
        "${CERTBOT_IMAGE}" certonly \
        --webroot --webroot-path "${WEBROOT}" \
        --domain "${DOMAIN}" \
        --email "${CERT_EMAIL}" \
        --agree-tos --no-eff-email --non-interactive \
        --keep-until-expiring \
        --preferred-challenges http \
        ${extra[@]+"${extra[@]}"}
}

certbot_renew() {
    local extra=()
    if [ "${DRY_RUN}" -eq 1 ]; then extra+=(--dry-run); fi
    if [ "${FORCE}" -eq 1 ]; then extra+=(--force-renewal); fi

    docker run --rm \
        -v "${LE_CONFIG}:${LE_CONFIG}" \
        -v "${LE_WORK}:${LE_WORK}" \
        -v "${WEBROOT}:${WEBROOT}" \
        "${CERTBOT_IMAGE}" renew \
        --webroot --webroot-path "${WEBROOT}" \
        --non-interactive \
        ${extra[@]+"${extra[@]}"}
}

print_renewal_notes() {
    echo
    log "renewal"
    cat <<RENEW
Add this single line to root's crontab (crontab -e). Twice a day is the
upstream recommendation; certbot exits immediately when nothing is due.

  17 3,15 * * * docker run --rm -v ${LE_CONFIG}:${LE_CONFIG} -v ${LE_WORK}:${LE_WORK} -v ${WEBROOT}:${WEBROOT} ${CERTBOT_IMAGE} renew --webroot -w ${WEBROOT} --quiet && nginx -s reload >> /var/log/certbot-renew.log 2>&1

Or use the packaged timer if you prefer:

  systemctl enable --now certbot.timer

Verify the timer-driven setup with:  certbot renew --dry-run
RENEW
}

main() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --dry-run)    DRY_RUN=1 ;;
            --staging)    STAGING=1 ;;
            --force)      FORCE=1 ;;
            --renew-only) RENEW_ONLY=1 ;;
            -h|--help)    usage; exit 0 ;;
            *)            die "unknown argument: $1 (try --help)" ;;
        esac
        shift
    done

    require_root
    require_tools
    mkdir -p "${WEBROOT}" "${LE_CONFIG}" "${LE_WORK}"
    dns_hint

    if [ "${RENEW_ONLY}" -eq 1 ]; then
        log "renew-only: refreshing the certificate (nginx untouched)"
        certbot_renew
        reload_nginx
        print_renewal_notes
        return 0
    fi

    if [ "${FORCE}" -eq 0 ] && [ -f "${LIVE_DIR}/fullchain.pem" ]; then
        log "certificate for ${DOMAIN} already exists — renewing if due"
        certbot_renew
        reload_nginx
        print_renewal_notes
        return 0
    fi

    log "issuing a certificate for ${DOMAIN}"
    if [ "${DRY_RUN}" -eq 1 ]; then
        warn "--dry-run: phase 1 is still required so that port 80 can answer the"
        warn "challenge; the temporary HTTP-only vhost is installed and left in"
        warn "place. Re-run without --dry-run to issue the real certificate and"
        warn "switch to deploy/nginx.conf."
    fi
    info "phase 1/3: temporary HTTP-only vhost"
    write_http_only_vhost
    reload_nginx

    log "phase 2/3: certbot webroot challenge"
    certbot_issue

    if [ "${DRY_RUN}" -eq 1 ]; then
        warn "dry-run finished: no certificate was saved and nginx still serves HTTP only"
        return 0
    fi

    log "phase 3/3: installing the TLS vhost"
    install_tls_vhost
    reload_nginx

    echo
    log "done — https://${DOMAIN} is now serving TLS"
    info "certificate: ${LIVE_DIR}/fullchain.pem"
    info "renewal config: /etc/letsencrypt/renewal/${DOMAIN}.conf"
    print_renewal_notes
}

main "$@"
