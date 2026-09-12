"""Idempotent demo data.

Run it explicitly:

    python -m app.seed

Re-running it never duplicates rows: each demo record is inserted only when no
row with the same title already exists.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import SessionLocal, init_db
from app.models import Item

# (title, description, done)
DEMO_ITEMS: tuple[tuple[str, str, bool], ...] = (
    (
        "Read the README",
        "Local dev is three commands; deployment is three more.",
        True,
    ),
    (
        "Wire up the JSON API",
        "GET/POST /api/items, PATCH/DELETE /api/items/{id}.",
        False,
    ),
    (
        "Ship it",
        "bash deploy/deploy.sh — DNS first, then nginx, then certbot.",
        False,
    ),
)


def seed(session: Session | None = None) -> int:
    """Insert the demo rows. Returns the number of rows actually created."""
    owns_session = session is None
    db = session or SessionLocal()
    try:
        created = 0
        for title, description, done in DEMO_ITEMS:
            exists = db.scalar(select(Item.id).where(Item.title == title).limit(1))
            if exists is not None:
                continue
            db.add(Item(title=title, description=description, done=done))
            created += 1
        if created:
            db.commit()
        return created
    finally:
        if owns_session:
            db.close()


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        created = seed(db)
        total = db.scalar(select(func.count()).select_from(Item)) or 0
    finally:
        db.close()
    print(f"seed complete: {created} row(s) inserted, {total} row(s) in total")


if __name__ == "__main__":
    main()
