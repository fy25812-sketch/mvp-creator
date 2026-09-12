"""JSON CRUD API for the ``Item`` entity.

Routes are declared with absolute paths (no router prefix) so that the public
paths are exactly ``/api/items`` and ``/api/items/{item_id}`` — no trailing
slash redirect, no ambiguity.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Item, utcnow
from app.schemas import ItemCreate, ItemList, ItemRead, ItemUpdate

router = APIRouter(tags=["items"])


def _get_or_404(db: Session, item_id: int) -> Item:
    item = db.get(Item, item_id)
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"item {item_id} not found",
        )
    return item


@router.get("/api/items", response_model=ItemList, summary="List items")
def list_items(
    limit: int = Query(default=50, ge=1, le=200, description="Page size"),
    offset: int = Query(default=0, ge=0, description="Rows to skip"),
    db: Session = Depends(get_db),
) -> ItemList:
    total = db.scalar(select(func.count()).select_from(Item)) or 0
    rows = db.scalars(
        select(Item).order_by(Item.id.desc()).limit(limit).offset(offset)
    ).all()
    return ItemList(
        total=total,
        limit=limit,
        offset=offset,
        items=[ItemRead.model_validate(row) for row in rows],
    )


@router.get("/api/items/{item_id}", response_model=ItemRead, summary="Get one item")
def get_item(item_id: int, db: Session = Depends(get_db)) -> ItemRead:
    return ItemRead.model_validate(_get_or_404(db, item_id))


@router.post(
    "/api/items",
    response_model=ItemRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create an item",
)
def create_item(payload: ItemCreate, db: Session = Depends(get_db)) -> ItemRead:
    item = Item(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return ItemRead.model_validate(item)


@router.patch("/api/items/{item_id}", response_model=ItemRead, summary="Update an item")
def update_item(
    item_id: int, payload: ItemUpdate, db: Session = Depends(get_db)
) -> ItemRead:
    item = _get_or_404(db, item_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    item.updated_at = utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return ItemRead.model_validate(item)


@router.delete(
    "/api/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    summary="Delete an item",
)
def delete_item(item_id: int, db: Session = Depends(get_db)) -> Response:
    item = _get_or_404(db, item_id)
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
