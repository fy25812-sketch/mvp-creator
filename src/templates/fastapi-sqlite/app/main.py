"""FastAPI application entrypoint for {{PROJECT_NAME}}.

Two surfaces share one SQLite database:

* the JSON API under ``/api`` (plus ``/healthz``),
* a server-rendered HTML page at ``/`` (pure HTML forms, no JavaScript
  framework, no CDN — it works offline).

``ENABLE_DOCS=false`` removes ``/docs``, ``/redoc`` and ``/openapi.json``
entirely; that is the deployment baseline.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import Depends, FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import health, items
from app.config import get_settings
from app.db import get_db, init_db
from app.models import Item, utcnow

settings = get_settings()

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"


async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Create the schema before the first request is served."""
    init_db()
    yield


app = FastAPI(
    title=settings.app_title,
    version=settings.app_version,
    description="Rendered by MVP Creator — FastAPI + SQLAlchemy 2.0 + SQLite.",
    docs_url="/docs" if settings.enable_docs else None,
    redoc_url="/redoc" if settings.enable_docs else None,
    openapi_url="/openapi.json" if settings.enable_docs else None,
    lifespan=lifespan,
)

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

app.include_router(health.router)
app.include_router(items.router)


# --------------------------------------------------------------------------- #
# Server-rendered page                                                        #
# --------------------------------------------------------------------------- #
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index(request: Request, db: Session = Depends(get_db)) -> HTMLResponse:
    """List the newest rows plus a create form."""
    rows = db.scalars(select(Item).order_by(Item.id.desc()).limit(100)).all()
    total = db.scalar(select(func.count()).select_from(Item)) or 0
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "items": rows,
            "total": total,
            "project_name": settings.project_name,
            "primary_entity": settings.primary_entity,
        },
    )


@app.post("/items", include_in_schema=False)
def create_item_form(
    title: str = Form(default="", max_length=200),
    description: str = Form(default="", max_length=2000),
    db: Session = Depends(get_db),
) -> Response:
    """Handle the HTML form: create one row and redirect back (PRG pattern)."""
    clean_title = title.strip()
    if clean_title:
        db.add(
            Item(
                title=clean_title,
                description=description.strip() or None,
            )
        )
        db.commit()
    return RedirectResponse(url="/", status_code=303)


@app.post("/items/{item_id}/toggle", include_in_schema=False)
def toggle_item_form(item_id: int, db: Session = Depends(get_db)) -> Response:
    """Flip the boolean ``done`` flag from the list page."""
    item = db.get(Item, item_id)
    if item is not None:
        item.done = not item.done
        item.updated_at = utcnow()
        db.add(item)
        db.commit()
    return RedirectResponse(url="/", status_code=303)


@app.post("/items/{item_id}/delete", include_in_schema=False)
def delete_item_form(item_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a row from the list page."""
    item = db.get(Item, item_id)
    if item is not None:
        db.delete(item)
        db.commit()
    return RedirectResponse(url="/", status_code=303)


if __name__ == "__main__":  # pragma: no cover - manual smoke run
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=settings.app_port,
        reload=True,
    )
