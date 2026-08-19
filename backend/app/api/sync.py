"""目录同步管理 API"""

from __future__ import annotations

import json
import logging
import os
import uuid

from fastapi import APIRouter, HTTPException

from app.db.database import db_manager
from app.models.schemas import SyncFolderCreate, SyncFolderUpdate, SyncFolderResponse
from app.core.sync_service import sync_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["sync"])


@router.get("/collections/{collection_id}/sync-folders")
async def get_sync_folders(collection_id: str):
    """获取知识库的所有同步目录配置"""
    collection = await db_manager.get_collection(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="知识库不存在")
    folders = await db_manager.get_sync_folders_by_collection(collection_id)
    return folders


@router.post("/collections/{collection_id}/sync-folders", status_code=201)
async def create_sync_folder(collection_id: str, body: SyncFolderCreate):
    """添加同步目录"""
    # 1. 验证collection存在
    collection = await db_manager.get_collection(collection_id)
    if not collection:
        raise HTTPException(status_code=404, detail="知识库不存在")

    # 2. 验证目录存在
    if not os.path.isdir(body.folder_path):
        raise HTTPException(status_code=400, detail=f"目录不存在: {body.folder_path}")

    # 3. 创建记录
    sync_id = uuid.uuid4().hex
    ignore_patterns_json = json.dumps(body.ignore_patterns) if body.ignore_patterns else '[]'

    folder = await db_manager.create_sync_folder(
        sync_id=sync_id,
        collection_id=collection_id,
        folder_path=body.folder_path,
        poll_interval=body.poll_interval,
        auto_vectorize=body.auto_vectorize,
        auto_extract=body.auto_extract,
        file_filter=body.file_filter,
        ignore_patterns=ignore_patterns_json,
    )

    # 4. 通知SyncService启动轮询
    await sync_service.add_folder(folder)

    return folder


@router.put("/sync-folders/{sync_id}")
async def update_sync_folder(sync_id: str, body: SyncFolderUpdate):
    """更新同步目录配置"""
    folder = await db_manager.get_sync_folder(sync_id)
    if not folder:
        raise HTTPException(status_code=404, detail="同步目录不存在")

    # 构建更新字段
    update_kwargs = {}
    if body.poll_interval is not None:
        update_kwargs['poll_interval'] = body.poll_interval
    if body.auto_vectorize is not None:
        update_kwargs['auto_vectorize'] = body.auto_vectorize
    if body.auto_extract is not None:
        update_kwargs['auto_extract'] = body.auto_extract
    if body.file_filter is not None:
        update_kwargs['file_filter'] = body.file_filter
    if body.ignore_patterns is not None:
        update_kwargs['ignore_patterns'] = json.dumps(body.ignore_patterns)
    if body.active is not None:
        update_kwargs['active'] = body.active

    if update_kwargs:
        await db_manager.update_sync_folder(sync_id, **update_kwargs)

    # 重启轮询（使用新配置）
    updated = await db_manager.get_sync_folder(sync_id)
    await sync_service.update_folder(updated)

    return updated


@router.delete("/sync-folders/{sync_id}")
async def delete_sync_folder(sync_id: str):
    """删除同步目录（不删除已同步的文档）"""
    folder = await db_manager.get_sync_folder(sync_id)
    if not folder:
        raise HTTPException(status_code=404, detail="同步目录不存在")

    # 停止轮询
    await sync_service.remove_folder(sync_id)

    # 删除记录
    await db_manager.delete_sync_folder(sync_id)

    return {"message": "已删除同步目录"}


@router.post("/sync-folders/{sync_id}/trigger")
async def trigger_sync(sync_id: str):
    """手动触发一次同步"""
    folder = await db_manager.get_sync_folder(sync_id)
    if not folder:
        raise HTTPException(status_code=404, detail="同步目录不存在")

    await sync_service.trigger_sync(sync_id)

    return {"message": "同步已触发"}


@router.get("/sync-folders/{sync_id}/status")
async def get_sync_status(sync_id: str):
    """获取同步状态"""
    folder = await db_manager.get_sync_folder(sync_id)
    if not folder:
        raise HTTPException(status_code=404, detail="同步目录不存在")

    is_running = sync_id in sync_service._tasks and not sync_service._tasks[sync_id].done()

    return {
        "id": folder['id'],
        "folder_path": folder['folder_path'],
        "active": folder['active'],
        "is_running": is_running,
        "last_synced_at": folder.get('last_synced_at', ''),
        "poll_interval": folder.get('poll_interval', 30),
    }
