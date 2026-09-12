"""Application settings, read from environment variables and/or a `.env` file.

Every value can be overridden by an environment variable of the same name in
upper case (``APP_PORT``, ``DATABASE_URL``, ``ENABLE_DOCS``, ...). See
`.env.example` for the full list.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for {{PROJECT_NAME}}."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- identity ----------------------------------------------------------
    project_name: str = "{{PROJECT_NAME}}"
    app_title: str = "{{APP_TITLE}}"
    app_version: str = "0.1.0"
    primary_entity: str = "{{PRIMARY_ENTITY}}"

    # ---- server ------------------------------------------------------------
    # Host port used by docker compose / nginx. The process itself always binds
    # the port given on the uvicorn command line (8000 in the container).
    app_port: int = 8000
    log_level: str = "info"

    # When false, /docs, /redoc and /openapi.json are not mounted at all. Keep
    # it false in production: the deployment baseline sets ENABLE_DOCS=false.
    enable_docs: bool = True

    # ---- storage -----------------------------------------------------------
    # SQLite file; the parent directory is created on import by app.db.
    database_url: str = "sqlite:///./data/app.db"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings singleton."""
    return Settings()
