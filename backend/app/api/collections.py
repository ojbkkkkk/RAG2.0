"""RAG2.0 知识库管理 API"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.db.database import db_manager
from app.models.schemas import CollectionCreate, CollectionResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collections", tags=["collections"])


# ── 创建知识库 ──────────────────────────────────────────────


@router.post("", response_model=CollectionResponse, status_code=201)
async def create_collection(body: CollectionCreate):
    """创建知识库（同时在 ChromaDB 中创建对应 collection）"""
    # 检查同名知识库是否已存在
    existing = await db_manager.get_collection_by_name(body.name)
    if existing:
        raise HTTPException(status_code=409, detail=f"知识库 '{body.name}' 已存在")

    coll = await db_manager.create_collection(
        name=body.name, description=body.description,
        chunk_size=body.chunk_size, chunk_overlap=body.chunk_overlap,
    )
    logger.info("创建知识库: %s (%s)", body.name, coll["id"])
    return CollectionResponse(**coll)


# ── 列出所有知识库 ──────────────────────────────────────────


@router.get("", response_model=list[CollectionResponse])
async def list_collections():
    """列出所有知识库"""
    collections = await db_manager.list_collections()
    return [CollectionResponse(**c) for c in collections]


# ── 获取单个知识库详情 ─────────────────────────────────────


@router.get("/{collection_id}", response_model=CollectionResponse)
async def get_collection(collection_id: str):
    """获取知识库详情（含文档/分块统计）"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")
    return CollectionResponse(**coll)


# ── 删除知识库 ──────────────────────────────────────────────


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(collection_id: str):
    """删除知识库（同时删除 ChromaDB collection 及所有关联文档、chunks）"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    await db_manager.delete_collection(name=coll["name"])
    logger.info("删除知识库: %s (%s)", coll["name"], collection_id)
