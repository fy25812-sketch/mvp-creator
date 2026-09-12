"""Smoke tests: health, page render, CRUD, pagination and the docs baseline.

The app modules are imported *after* the environment is redirected to a
throwaway SQLite file, because ``app.db`` builds the engine at import time and
``app.config`` caches its settings.

The throwaway file lives inside the project (``.pytest-tmp/``, gitignored)
rather than in the system temp directory: a session running under a filesystem
sandbox cannot create files in the system temp area, and a test suite that only
passes on an unconfined machine is not a usable smoke test. It is deleted at
import time so every run starts from an empty schema.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest

_TMP_DIR = Path(__file__).resolve().parent.parent / ".pytest-tmp"
_TMP_DIR.mkdir(parents=True, exist_ok=True)
_DB_FILE = _TMP_DIR / "test.db"
_DB_FILE.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{_DB_FILE.as_posix()}"
os.environ["ENABLE_DOCS"] = "false"
os.environ["APP_VERSION"] = "0.1.0"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture()
def client() -> Iterator[TestClient]:
    """A TestClient bound to the app lifespan (which creates the schema)."""
    with TestClient(app) as test_client:
        yield test_client


def test_healthz(client: TestClient) -> None:
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}


def test_index_page_renders(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'action="/items"' in response.text
    assert "Add a new" in response.text


def test_create_list_update_delete(client: TestClient) -> None:
    created = client.post(
        "/api/items", json={"title": "first", "description": "hello"}
    )
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["id"] > 0
    assert item["done"] is False
    item_id = item["id"]

    listed = client.get("/api/items")
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] >= 1
    assert body["limit"] == 50
    assert body["offset"] == 0
    assert any(row["id"] == item_id for row in body["items"])

    patched = client.patch(f"/api/items/{item_id}", json={"done": True})
    assert patched.status_code == 200
    assert patched.json()["done"] is True
    assert patched.json()["title"] == "first"

    fetched = client.get(f"/api/items/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json()["done"] is True

    deleted = client.delete(f"/api/items/{item_id}")
    assert deleted.status_code == 204
    assert client.get(f"/api/items/{item_id}").status_code == 404


def test_pagination(client: TestClient) -> None:
    for index in range(3):
        assert (
            client.post("/api/items", json={"title": f"page-{index}"}).status_code
            == 201
        )

    page = client.get("/api/items", params={"limit": 2, "offset": 1})
    assert page.status_code == 200
    body = page.json()
    assert body["limit"] == 2
    assert body["offset"] == 1
    assert len(body["items"]) == 2

    assert client.get("/api/items", params={"limit": 0}).status_code == 422
    assert client.get("/api/items", params={"offset": -1}).status_code == 422


def test_html_form_roundtrip(client: TestClient) -> None:
    posted = client.post(
        "/items",
        data={"title": "from-form", "description": "typed by hand"},
        follow_redirects=True,
    )
    assert posted.status_code == 200
    assert "from-form" in posted.text


def test_docs_disabled_by_default(client: TestClient) -> None:
    assert client.get("/docs").status_code == 404
    assert client.get("/redoc").status_code == 404
    assert client.get("/openapi.json").status_code == 404
