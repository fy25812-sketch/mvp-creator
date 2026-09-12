"""{{PROJECT_NAME}} — a small FastAPI + SQLite MVP.

Rendered by the MVP Creator plugin on {{GENERATED_AT}}.

Layout:
    app.config   — environment driven settings
    app.db       — SQLAlchemy 2.0 engine / session / Base
    app.models   — ORM models
    app.schemas  — pydantic v2 request & response models
    app.api      — JSON API routers
    app.main     — FastAPI application, server-rendered index page
    app.seed     — idempotent demo data (python -m app.seed)
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
