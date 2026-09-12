# {{PROJECT_NAME}} — production image (rendered by MVP Creator on {{GENERATED_AT}})
#
# Multi-stage build:
#   builder  — compiles/installs the wheels into a self-contained virtualenv
#   runtime  — slim base + that virtualenv, running as a non-root user
#
# Build:  docker build -t {{CONTAINER_NAME}}:latest .
# Run:    docker run --rm -p 127.0.0.1:{{APP_PORT}}:8000 -v "$PWD/data:/app/data" {{CONTAINER_NAME}}:latest

# --------------------------------------------------------------------------- #
# Stage 1 — builder
# --------------------------------------------------------------------------- #
FROM python:3.12-slim AS builder

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_ROOT_USER_ACTION=ignore

# build-essential is only needed here, for packages without a cp312 wheel.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build
COPY requirements.txt ./
RUN python -m pip install --upgrade pip \
    && python -m pip install -r requirements.txt

# --------------------------------------------------------------------------- #
# Stage 2 — runtime
# --------------------------------------------------------------------------- #
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="{{CONTAINER_NAME}}" \
      org.opencontainers.image.description="{{PROJECT_NAME}} — FastAPI + SQLite MVP" \
      org.opencontainers.image.created="{{GENERATED_AT}}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    PATH="/opt/venv/bin:$PATH" \
    APP_PORT=8000 \
    ENABLE_DOCS=false

RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

# Dependencies first: this layer only changes when requirements.txt changes.
COPY --from=builder /opt/venv /opt/venv
COPY --chown=appuser:appuser . .

# SQLite lives on a bind-mounted host directory (see docker-compose.yml).
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

USER appuser

EXPOSE 8000

# Matches compose/nginx: probe the app's own endpoint without needing curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
