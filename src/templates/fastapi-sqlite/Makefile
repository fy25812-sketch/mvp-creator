# {{PROJECT_NAME}} — developer shortcuts
#
# Windows note: recipes below use the POSIX layout of a virtualenv
# (.venv/bin/...). Run them from WSL or Git Bash. In PowerShell, create the venv
# first and then call .venv\Scripts\python -m <module> ... instead.

PY      ?= python3.12
VENV    ?= .venv
BIN     ?= $(VENV)/bin
COMPOSE ?= docker compose
SERVICE ?= {{CONTAINER_NAME}}
PORT    ?= {{APP_PORT}}

.PHONY: help dev install run test seed build up down logs shell clean

help: ## show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk 'BEGIN { FS = ":.*?## " } { printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2 }'

dev: install ## create the virtualenv and install dependencies

install: ## (re)install dependencies into $(VENV)
	$(PY) -m venv $(VENV)
	$(BIN)/python -m pip install --upgrade pip
	$(BIN)/python -m pip install -r requirements.txt

run: ## run the dev server with autoreload on http://127.0.0.1:$(PORT)
	$(BIN)/uvicorn app.main:app --reload --host 127.0.0.1 --port $(PORT)

test: ## run the pytest suite
	$(BIN)/python -m pytest

seed: ## insert the idempotent demo rows
	$(BIN)/python -m app.seed

build: ## build the docker image
	$(COMPOSE) build

up: ## start the stack in the background
	$(COMPOSE) up -d

down: ## stop the stack
	$(COMPOSE) down

logs: ## tail the container logs
	$(COMPOSE) logs --tail=100 -f

shell: ## open a shell inside the running container
	$(COMPOSE) exec $(SERVICE) /bin/sh

clean: ## remove the venv, caches and the local sqlite file
	rm -rf $(VENV) .pytest_cache
	rm -f data/app.db data/test.db
