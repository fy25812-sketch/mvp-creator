"""ORM models for {{PROJECT_NAME}}."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    """Timezone-aware UTC timestamp (a callable default, evaluated per row)."""
    return datetime.now(timezone.utc)


class Item(Base):
    """The single business entity of this MVP.

    The JSON API exposes it at ``/api/items``; the server-rendered page at ``/``
    lists and edits the same rows.
    """

    __tablename__ = "items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    done: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    # Pre-formatted for the Jinja2 page: keeping the strftime pattern in Python
    # keeps every template expression lowercase (the MVP Creator placeholder
    # contract reserves double-brace UPPERCASE tokens for the renderer).
    @property
    def created_display(self) -> str:
        return self.created_at.strftime("%Y-%m-%d %H:%M")

    def __repr__(self) -> str:  # pragma: no cover - debugging helper
        return f"<Item id={self.id} title={self.title!r} done={self.done!r}>"
