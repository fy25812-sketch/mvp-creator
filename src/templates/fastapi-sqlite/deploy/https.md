# HTTPS for {{DOMAIN}}

Everything here runs **on the server** ({{SSH_USER}}@{{SSH_HOST}}), from
`{{REMOTE_DIR}}`. The application container is published on
`127.0.0.1:{{APP_PORT}}` only; host nginx owns ports 80 and 443 and terminates
TLS. Nothing in this document touches the application code.

Rendered by MVP Creator on {{GENERATED_AT}}.

---

## 0. What you need first

| Requirement | Check |
| --- | --- |
| DNS A record for `{{DOMAIN}}` → this server's public IP | `getent hosts {{DOMAIN}}` |
| Ports 80 **and** 443 open in the firewall / security group | `sudo ss -lntp \| grep -E ':80\|:443'` |
| nginx installed and running | `nginx -v && systemctl status nginx` |
| The app deployed and healthy | `curl -fsS http://127.0.0.1:{{APP_PORT}}/healthz` |
| Docker available (certbot runs as a container) | `docker version` |

Let's Encrypt validates over **port 80**, so port 80 must be reachable from the
public internet even though every real request ends up on 443.

---

## 1. DNS

Create one record at your DNS provider:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| `A` | `{{DOMAIN}}` | *this server's public IPv4* | `300` |

If the host is IPv4-only behind a NAT, forward public `80`/`443` to the private
address. For IPv6 add an `AAAA` record pointing at the host's global address —
and only add it if the server really answers on IPv6, otherwise certificate
issuance can fail intermittently.

Verify propagation **before** asking for a certificate:

```bash
getent hosts {{DOMAIN}}            # or: dig +short A {{DOMAIN}}
dig +short A {{DOMAIN}} @1.1.1.1   # authoritative answer via a public resolver
```

The answer must be the public IP of {{SSH_HOST}}. If it is still empty, wait for
the TTL — issuing too early fails with `DNS problem: NXDOMAIN`.

---

## 2. Deploy the application first

The nginx vhost proxies to `127.0.0.1:{{APP_PORT}}`, so the container has to be
up before HTTPS is worth configuring:

```bash
bash deploy/deploy.sh        # or, from your workstation: bash deploy/deploy.sh
curl -fsS http://127.0.0.1:{{APP_PORT}}/healthz
# {"status":"ok","version":"0.1.0"}
```

---

## 3. First issuance — the required order

`deploy/nginx.conf` points at
`/etc/letsencrypt/live/{{DOMAIN}}/fullchain.pem`. That file does not exist yet,
and nginx refuses to start when an `ssl_certificate` path is missing. The order
is therefore always:

1. **HTTP-only vhost** — a temporary `server` block for `{{DOMAIN}}` on port 80
   that serves `/.well-known/acme-challenge/` from `/var/www/certbot`.
2. **Issue** — certbot (in Docker) answers the HTTP-01 challenge over that
   webroot and writes `/etc/letsencrypt/live/{{DOMAIN}}/`.
3. **Reload** — copy the real `deploy/nginx.conf` into
   `/etc/nginx/conf.d/{{CONTAINER_NAME}}.conf` and reload nginx, which now adds
   the 80 → 443 redirect and the TLS listener.

`deploy/init-letsencrypt.sh` performs those three phases by itself:

```bash
# recommended dry rehearsal first (certbot --dry-run, no certificate saved)
sudo bash deploy/init-letsencrypt.sh --dry-run

# real issuance + install of the TLS vhost + reload
sudo bash deploy/init-letsencrypt.sh
```

Notes:

* `--dry-run` uses the staging endpoint and saves **nothing**. Because the ACME
  challenge still needs to be served, the temporary HTTP-only vhost stays
  installed — re-run without the flag to finish.
* `--staging` issues a *real* but untrusted certificate. Use it while iterating,
  so you do not burn the production rate limit (5 failures per account per
  hostname per hour, 5 duplicate certificates per week).
* The script backs up any pre-existing vhost to
  `/etc/nginx/conf.d/{{CONTAINER_NAME}}.conf.bak`.

### Doing it by hand (if you prefer)

```bash
# 1. HTTP-only vhost, then validate + start
sudo tee /etc/nginx/conf.d/{{CONTAINER_NAME}}.conf >/dev/null <<'CONF'
server {
    listen      80;
    listen      [::]:80;
    server_name {{DOMAIN}};
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:{{APP_PORT}}; proxy_set_header Host $host; }
}
CONF
sudo mkdir -p /var/www/certbot
sudo nginx -t && sudo systemctl reload nginx

# 2. issue
sudo docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d {{DOMAIN}} --email {{CERT_EMAIL}} \
  --agree-tos --no-eff-email --non-interactive

# 3. install the real vhost and reload
sudo cp {{REMOTE_DIR}}/deploy/nginx.conf /etc/nginx/conf.d/{{CONTAINER_NAME}}.conf
sudo nginx -t && sudo systemctl reload nginx
```

### Verify

```bash
curl -sSI https://{{DOMAIN}}/healthz | head -n 1        # HTTP/2 200
curl -sSI http://{{DOMAIN}}/healthz  | grep -i location # 301 -> https://{{DOMAIN}}/...
echo | openssl s_client -connect {{DOMAIN}}:443 -servername {{DOMAIN}} 2>/dev/null \
  | openssl x509 -noout -subject -dates
```

---

## 4. Renewal

Let's Encrypt certificates last 90 days. Renewal only replaces files under
`/etc/letsencrypt/live/`; nginx keeps serving the old certificate until it is
reloaded, so **every renewal must be followed by a reload**.

Cron (root's crontab — `sudo crontab -e`), twice a day as recommended upstream:

```cron
17 3,15 * * * docker run --rm -v /etc/letsencrypt:/etc/letsencrypt -v /var/lib/letsencrypt:/var/lib/letsencrypt -v /var/www/certbot:/var/www/certbot certbot/certbot renew --webroot -w /var/www/certbot --quiet && nginx -s reload >> /var/log/certbot-renew.log 2>&1
```

Or, if the distro ships the packaged timer:

```bash
sudo systemctl enable --now certbot.timer
systemctl list-timers certbot.timer
```

Rehearse safely at any time — `--dry-run` never touches the live certificate:

```bash
sudo bash deploy/init-letsencrypt.sh --dry-run
# or
sudo docker run --rm -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot renew --webroot -w /var/www/certbot --dry-run
```

---

## 5. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `DNS problem: NXDOMAIN looking up A for {{DOMAIN}}` | The A record is missing or not propagated yet. `dig +short A {{DOMAIN}} @1.1.1.1`; wait out the TTL, then retry. |
| `Timeout during connect (likely firewall problem)` | Port 80 is blocked. Open it in the cloud security group **and** in `ufw`/`firewalld` (`sudo ufw allow 80,443/tcp`). |
| `Invalid response ... /.well-known/acme-challenge/...: 404` | nginx is not serving the challenge: the HTTP-only vhost is missing, the `root /var/www/certbot;` path is wrong, or another vhost matched first (`server_name` typo / duplicate `default_server`). `sudo nginx -T \| grep -A3 acme-challenge`. |
| `nginx: [emerg] cannot load certificate ... No such file or directory` | The TLS vhost was installed before issuance. Run `sudo bash deploy/init-letsencrypt.sh` (phase order matters), or restore the backup: `sudo cp /etc/nginx/conf.d/{{CONTAINER_NAME}}.conf.bak /etc/nginx/conf.d/{{CONTAINER_NAME}}.conf`. |
| `too many failed authorizations` / `too many certificates already issued` | You hit the Let's Encrypt rate limit. Wait it out and rehearse with `--staging` or `--dry-run`. |
| `502 Bad Gateway` right after a deploy | Nothing is listening on `127.0.0.1:{{APP_PORT}}`. `docker compose ps`, `docker compose logs --tail=100`; confirm the container is healthy and bound to loopback. |
| Old certificate still served after renewal | nginx was not reloaded: `sudo nginx -t && sudo systemctl reload nginx`. |
| `docker: permission denied while trying to connect to the Docker daemon` | Run the script with `sudo`, or set `DOCKER_SUDO=1` for the deploy/rollback scripts. |

Logs worth reading:

```bash
sudo tail -n 100 /var/log/letsencrypt/letsencrypt.log
sudo tail -n 100 /var/log/nginx/error.log
cd {{REMOTE_DIR}} && docker compose logs --tail=100
```

---

## 6. Files this setup owns

| Path | Purpose |
| --- | --- |
| `/etc/nginx/conf.d/{{CONTAINER_NAME}}.conf` | vhost (80 → 443 redirect, TLS, proxy to `127.0.0.1:{{APP_PORT}}`) |
| `/etc/letsencrypt/live/{{DOMAIN}}/` | certificate, chain and private key |
| `/var/www/certbot/` | ACME HTTP-01 webroot |
| `{{REMOTE_DIR}}/deploy/nginx.conf` | the versioned source of the vhost |
| `{{REMOTE_DIR}}/deploy/init-letsencrypt.sh` | issuance + renewal entry point |
