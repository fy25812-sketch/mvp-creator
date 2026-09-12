# {{PROJECT_NAME}}

> **This is a template, not an application.**
> It is rendered by the **MVP Creator** DSH plugin, which performs *literal*
> double-brace placeholder substitution only — no expressions, no loops, no
> derived values. Every token it understands is listed in
> [Placeholders](#placeholders) below. Do not edit generated copies expecting
> the raw file to change: edit the template (or a fresh render) and re-deploy.

`{{PROJECT_NAME}}` (slug `{{PROJECT_SLUG}}`) is a deliberately small, fully
offline-runnable MVP: FastAPI + SQLAlchemy 2.0 + SQLite + server-rendered
Jinja2. No Redis, no Celery, no queue, no external service, no CDN — the whole
thing runs from a clean checkout with `pip install -r requirements.txt`.

Rendered on `{{GENERATED_AT}}` for `https://{{DOMAIN}}`.

---

## What is in the box

| Layer | Choice |
| --- | --- |
| Runtime | Python 3.12+, FastAPI, Uvicorn |
| ORM | SQLAlchemy 2.0 declarative (`Mapped[...]` / `mapped_column`) — **not** SQLModel |
| Validation | pydantic v2 (+ pydantic-settings) |
| Storage | SQLite file at `data/app.db`, directory created automatically |
| Migrations | none — `Base.metadata.create_all()` on startup (no Alembic) |
| UI | one Jinja2 page, inline `<style>`, plain HTML forms, zero JavaScript |
| Tests | pytest + `fastapi.testclient.TestClient` (httpx) |
| Container | multi-stage `python:3.12-slim`, non-root uid 10001, `HEALTHCHECK` on `/healthz` |
| Edge | host nginx + certbot (see [deploy/https.md](deploy/https.md)) |

---

## Local development — three steps

```bash
python -m venv .venv && . .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload                   # http://127.0.0.1:8000
```

Then open <http://127.0.0.1:8000>. Optional extras:

```bash
python -m app.seed      # 3 idempotent demo rows; re-running never duplicates
pytest                  # smoke tests (health, page, CRUD, pagination, docs-off)
```

`make dev|run|test|seed|build|up|down` wraps the same commands (WSL/Git Bash).

---

## Deployment — three steps

```bash
# 1. DNS: point an A record for {{DOMAIN}} at {{SSH_HOST}}, wait for the TTL
# 2. deploy the container (build + up + health check + tag bookkeeping)
bash deploy/deploy.sh --dry-run      # rehearse: prints every command, changes nothing
bash deploy/deploy.sh                # real deploy; fails loudly if /healthz never turns 200
# 3. TLS (on the server, once)
ssh {{SSH_USER}}@{{SSH_HOST}}
sudo bash {{REMOTE_DIR}}/deploy/init-letsencrypt.sh --dry-run   # certbot rehearsal
sudo bash {{REMOTE_DIR}}/deploy/init-letsencrypt.sh             # issue + reload nginx
```

After that, every deploy is just `bash deploy/deploy.sh`, and a bad release is
undone with `bash deploy/rollback.sh` (it re-runs the tag recorded in
`.deployed-tag.prev`, without rebuilding).

Full walkthrough: [deploy/https.md](deploy/https.md).

---

## Placeholders

The renderer substitutes exactly these tokens, literally, everywhere:

| Placeholder | Meaning | In this render |
| --- | --- | --- |
| `{{PROJECT_NAME}}` | display name | {{PROJECT_NAME}} |
| `{{PROJECT_SLUG}}` | slug / package name | {{PROJECT_SLUG}} |
| `{{APP_TITLE}}` | browser page title | {{APP_TITLE}} |
| `{{PRIMARY_ENTITY}}` | business entity, singular lowercase | {{PRIMARY_ENTITY}} |
| `{{DOMAIN}}` | public domain | {{DOMAIN}} |
| `{{APP_PORT}}` | host port bound by the container (loopback only) | {{APP_PORT}} |
| `{{SSH_USER}}` | deploy user | {{SSH_USER}} |
| `{{SSH_HOST}}` | server IP / hostname | {{SSH_HOST}} |
| `{{REMOTE_DIR}}` | absolute deploy directory on the server | {{REMOTE_DIR}} |
| `{{CERT_EMAIL}}` | Let's Encrypt contact address | {{CERT_EMAIL}} |
| `{{CONTAINER_NAME}}` | compose project, service, container and image name | {{CONTAINER_NAME}} |
| `{{GENERATED_AT}}` | ISO timestamp of the render | {{GENERATED_AT}} |

Inside the Jinja2 template (`app/templates/index.html`) the *runtime* variables
are deliberately lowercase — `items`, `total`, `item.title`, `item.id`,
`item.done`, `item.created_display`, and the loop tag `for item in items` — so
they can never collide with renderer tokens. That is also why the date format
lives in Python (`Item.created_display`) instead of in the page: no Jinja
expression anywhere needs an uppercase letter.

---

## HTTP surface

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/healthz` | `{"status":"ok","version":"0.1.0"}` — no database access |
| `GET` | `/` | HTML: entity list + create form + inline toggle/delete forms |
| `GET` | `/api/items` | paginated list: `?limit=` (1–200, default 50), `?offset=` (≥0) |
| `GET` | `/api/items/{id}` | single row, `404` when missing |
| `POST` | `/api/items` | create, `201`, body `{"title","description?","done?"}` |
| `PATCH` | `/api/items/{id}` | partial update — e.g. `{"done": true}` |
| `DELETE` | `/api/items/{id}` | `204`, empty body |

The HTML page posts to `/items`, `/items/{id}/toggle` and `/items/{id}/delete`
(plain form posts, `303` redirect back — the JSON API is untouched by them).

Docs endpoints exist only for development:

```bash
curl -s localhost:8000/api/items | python -m json.tool
curl -sX POST localhost:8000/api/items -H 'content-type: application/json' \
     -d '{"title":"hello"}' | python -m json.tool
curl -sX PATCH localhost:8000/api/items/1 -H 'content-type: application/json' \
     -d '{"done":true}' | python -m json.tool
```

---

## Configuration

All settings come from environment variables (and a local `.env`); see
[.env.example](.env.example), which lists every one of them.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROJECT_NAME` | `{{PROJECT_NAME}}` | display name |
| `APP_TITLE` | `{{APP_TITLE}}` | page title |
| `APP_VERSION` | `0.1.0` | reported by `/healthz` and the OpenAPI schema |
| `PRIMARY_ENTITY` | `{{PRIMARY_ENTITY}}` | label used on the HTML page |
| `APP_PORT` | `{{APP_PORT}}` | host port published by compose; the process itself always listens on 8000 |
| `LOG_LEVEL` | `info` | uvicorn/python log level |
| `ENABLE_DOCS` | `true` | `false` removes `/docs`, `/redoc` **and** `/openapi.json` |
| `DATABASE_URL` | `sqlite:///./data/app.db` | SQLAlchemy URL; the parent directory is created on import |

**Production baseline:** the image sets `ENABLE_DOCS=false` and pins
`DATABASE_URL=sqlite:////app/data/app.db`. The `.env` that compose reads on the
server is *not* overwritten by deploys (it holds that machine's secrets), so the
first deploy copies `.env.example` → `.env` remotely and then leaves it alone.

---

## Layout

```
.
├── app/
│   ├── main.py            FastAPI app, lifespan create_all, HTML routes
│   ├── config.py          pydantic-settings
│   ├── db.py              engine / SessionLocal / Base / get_db
│   ├── models.py          Item (SQLAlchemy 2.0 declarative)
│   ├── schemas.py         pydantic v2 models
│   ├── seed.py            idempotent demo data (python -m app.seed)
│   ├── api/health.py      GET /healthz
│   ├── api/items.py       JSON CRUD
│   └── templates/index.html
├── tests/test_smoke.py    pytest + TestClient
├── deploy/
│   ├── deploy.sh          tar-over-ssh deploy, health-gated, --dry-run
│   ├── rollback.sh        re-run the previous image tag
│   ├── init-letsencrypt.sh  HTTP-only → certbot → TLS vhost
│   ├── nginx.conf         host vhost for {{DOMAIN}}
│   └── https.md           DNS, first issuance, renewal, troubleshooting
├── Dockerfile             multi-stage, non-root, HEALTHCHECK
├── docker-compose.yml     single service, loopback port, ./data bind mount
├── Makefile / pyproject.toml / requirements.txt
└── .env.example .gitignore .dockerignore
```

---

## Operating notes

* **SQLite lives at `./data/app.db`** and is bind-mounted into the container.
  It survives rebuilds and rollbacks. Back it up with
  `sqlite3 data/app.db ".backup 'backup.db'"` (or just copy the file while the
  container is stopped).
* **`create_all` is not a migration tool.** Adding a column to an existing
  database needs a manual `ALTER TABLE` (or deleting `data/app.db` in
  development). That is the deliberate trade-off for an MVP with one table.
* **The port is loopback-only on purpose.** `docker-compose.yml` publishes
  `127.0.0.1:{{APP_PORT}}:8000`; nginx is the only public entry point, so no one
  can bypass TLS.
* **Deploys are idempotent.** Re-running `deploy/deploy.sh` re-syncs the source,
  rebuilds, restarts and re-checks health; `data/`, `.env` and `.deployed-tag`
  are excluded from the transfer so server-side state is preserved.
* **No JS, no CDN.** The page is a single Jinja2 template with an inline
  stylesheet, so it renders identically on an air-gapped network.
