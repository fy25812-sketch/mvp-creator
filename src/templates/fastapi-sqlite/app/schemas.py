"""pydantic v2 request/response models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ItemBase(BaseModel):
    """Fields shared by the create and read models."""

    title: str = Field(min_length=1, max_length=200, description="Short label")
    description: str | None = Field(default=None, max_length=2000)
    done: bool = False


class ItemCreate(ItemBase):
    """Payload for ``POST /api/items``."""


class ItemUpdate(BaseModel):
    """Payload for ``PATCH /api/items/{item_id}`` — every field is optional."""

    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    done: bool | None = None


class ItemRead(ItemBase):
    """Serialised representation returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime


class ItemList(BaseModel):
    """Paginated envelope returned by ``GET /api/items``."""

    total: int
    limit: int
    offset: int
    items: list[ItemRead]


class HealthResponse(BaseModel):
    """Body of ``GET /healthz``."""

    status: str
    version: str
