"""RAG2.0 系统状态 API — 组件运行状态、健康检测"""

from __future__ import annotations

import logging
import time
from pathlib import Path

from fastapi import APIRouter

from app.config import settings
from app.core.embedding import embedding_model
from app.db.database import db_manager
from app.parsers.ocr_utils import is_tesseract_available, is_easyocr_available

logger = logging.getLogger(__name__)

router = APIRouter(tags=["system"])

# ── 启动时间记录 ──────────────────────────────────────────────

_start_time: float = time.time()


def _format_uptime(seconds: float) -> str:
    """将秒数格式化为人类可读的时间"""
    days, rem = divmod(int(seconds), 86400)
    hours, rem = divmod(rem, 3600)
    minutes, secs = divmod(rem, 60)
    parts: list[str] = []
    if days > 0:
        parts.append(f"{days}天")
    if hours > 0:
        parts.append(f"{hours}小时")
    if minutes > 0:
        parts.append(f"{minutes}分钟")
    if not parts:
        parts.append(f"{secs}秒")
    return "".join(parts)


def _file_size_mb(path: Path) -> float:
    """获取文件大小（MB）"""
    try:
        return round(path.stat().st_size / (1024 * 1024), 2)
    except OSError:
        return 0.0


def _dir_size_mb(path: Path) -> float:
    """递归计算目录总大小（MB）"""
    try:
        total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        return round(total / (1024 * 1024), 2)
    except OSError:
        return 0.0


@router.get("/api/system/graph-stats")
async def get_graph_stats_global():
    """返回全局知识图谱统计信息及磁盘占用"""
    # ── 图谱统计 ──────────────────────────────────────────────
    total_entities = 0
    total_relations = 0
    entity_type_distribution: dict[str, int] = {}

    try:
        collections = await db_manager.list_collections()
        for coll in collections:
            coll_id = coll["id"]
            try:
                stats = await db_manager.get_graph_stats(coll_id)
                total_entities += stats.get("node_count", 0)
                total_relations += stats.get("edge_count", 0)
                for etype, cnt in stats.get("entity_type_distribution", {}).items():
                    entity_type_distribution[etype] = entity_type_distribution.get(etype, 0) + cnt
            except Exception as e:
                logger.warning("获取 collection %s 图谱统计失败: %s", coll_id, e)
    except Exception as e:
        logger.warning("获取 collections 列表失败: %s", e)

    # ── 磁盘占用 ──────────────────────────────────────────────
    chroma_mb = _dir_size_mb(settings.CHROMA_DIR)
    sqlite_mb = round(
        _file_size_mb(settings.DATA_DIR / "rag.db") +
        _file_size_mb(settings.DATA_DIR / "metadata.db"),
        2,
    )
    markdown_mb = _dir_size_mb(settings.MARKDOWN_DIR)
    uploads_mb = _dir_size_mb(settings.DATA_DIR / "uploads")
    total_mb = round(chroma_mb + sqlite_mb + markdown_mb + uploads_mb, 2)

    return {
        "total_entities": total_entities,
        "total_relations": total_relations,
        "entity_type_distribution": entity_type_distribution,
        "disk_usage": {
            "chroma_mb": chroma_mb,
            "sqlite_mb": sqlite_mb,
            "markdown_mb": markdown_mb,
            "uploads_mb": uploads_mb,
            "total_mb": total_mb,
        },
    }


@router.get("/api/system/status")
async def get_system_status():
    """返回各组件运行状态"""
    uptime_seconds = time.time() - _start_time
    uptime_str = _format_uptime(uptime_seconds)

    # ── 后端状态 ─────────────────────────────────────────────
    backend_status = {
        "status": "online",
        "uptime": uptime_str,
        "uptime_seconds": round(uptime_seconds, 1),
        "version": settings.MODEL_NAME.split("/")[-1] if "/" in settings.MODEL_NAME else settings.MODEL_NAME,
    }

    # ── Embedding 模型状态 ────────────────────────────────────
    if embedding_model.is_loaded:
        embed_status_val = "online"
        embed_detail = f"{settings.MODEL_NAME} · {settings.DEVICE}"
    else:
        embed_status_val = "standby"  # 待命，首次使用时加载
        embed_detail = "待命 · 首次使用时加载"
    embedding_status = {
        "status": embed_status_val,
        "model_name": settings.MODEL_NAME,
        "device": settings.DEVICE,
        "loaded": embedding_model.is_loaded,
        "detail": embed_detail,
    }

    # ── 向量数据库状态 ────────────────────────────────────────
    try:
        chroma_client = db_manager.chroma
        chroma_collections = chroma_client.list_collections()
        total_vectors = 0
        for coll in chroma_collections:
            count = coll.count()
            total_vectors += count
        vector_db_status = {
            "status": "online",
            "collections": len(chroma_collections),
            "total_vectors": total_vectors,
        }
    except Exception as e:
        logger.warning("ChromaDB 状态检测失败: %s", e)
        vector_db_status = {
            "status": "offline",
            "collections": 0,
            "total_vectors": 0,
            "error": str(e),
        }

    # ── OCR 引擎状态 ──────────────────────────────────────────
    tesseract_ok = is_tesseract_available()
    easyocr_ok = is_easyocr_available()
    if tesseract_ok:
        ocr_engine_name = "tesseract"
        ocr_available = True
    elif easyocr_ok:
        ocr_engine_name = "easyocr"
        ocr_available = True
    else:
        ocr_engine_name = "none"
        ocr_available = False
    ocr_status = {
        "status": "available" if ocr_available else "unavailable",
        "engine": ocr_engine_name,
        "tesseract": tesseract_ok,
        "easyocr": easyocr_ok,
    }

    # ── SQLite 数据库状态 ─────────────────────────────────────
    db_size = _file_size_mb(settings.SQLITE_PATH)
    database_status = {
        "status": "online" if db_manager._db is not None else "offline",
        "size_mb": db_size,
        "path": str(settings.SQLITE_PATH.name),
    }

    return {
        "backend": backend_status,
        "embedding_model": embedding_status,
        "vector_db": vector_db_status,
        "ocr_engine": ocr_status,
        "database": database_status,
    }
