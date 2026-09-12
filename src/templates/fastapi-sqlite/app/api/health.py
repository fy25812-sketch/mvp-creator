"""Liveness/readiness endpoint used by Docker, compose and nginx."""

from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings
from app.schemas import HealthResponse

router = APIRouter(tags=["health"])

settings = get_settings()


@router.get("/healthz", response_model=HealthResponse, summary="Health check")
def healthz() -> HealthResponse:
    """Always cheap: no database access, so it stays 200 even if SQLite is busy."""
    return HealthResponse(status="ok", version=settings.app_version)
