"""Database engine, session factory and declarative base (SQLAlchemy 2.0).

No Alembic and no migration tooling: the schema is created with
``Base.metadata.create_all()`` on application startup (see ``app.main``), which
is the right trade-off for a single-file SQLite MVP.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

SQLITE_PREFIX = "sqlite:///"


class Base(DeclarativeBase):
    """Declarative base shared by every ORM model."""


def ensure_sqlite_directory(database_url: str) -> None:
    """Create the parent directory of a SQLite file URL if it is missing.

    ``sqlite:///./data/app.db`` needs ``./data`` to exist, otherwise the first
    connection raises ``OperationalError: unable to open database file``.
    """
    if not database_url.startswith(SQLITE_PREFIX):
        return
    raw_path = database_url[len(SQLITE_PREFIX) :]
    if not raw_path or raw_path == ":memory:":
        return
    Path(raw_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


ensure_sqlite_directory(settings.database_url)

# check_same_thread=False lets FastAPI's threadpool reuse one SQLite connection
# across worker threads; it is safe because each request gets its own Session.
_connect_args = (
    {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
)

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
    class_=Session,
)


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a short-lived session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create all tables. Idempotent and safe to call on every startup."""
    from app import models  # noqa: F401  (import registers the mappers)

    Base.metadata.create_all(bind=engine)
