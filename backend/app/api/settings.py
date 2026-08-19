"""RAG2.0 系统配置 API"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException

from app.config import settings
from app.db.database import db_manager
from app.models.schemas import SettingsUpdate, SettingsResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# logo 保存目录
STATIC_DIR = settings.DATA_DIR / "static"
LOGO_DIR = STATIC_DIR / "logo"


def _mask_api_key(key: str) -> str:
    """API Key 脱敏：只显示最后4位"""
    if not key or len(key) <= 4:
        return "****" if key else ""
    return f"****{key[-4:]}"


@router.get("", response_model=SettingsResponse)
async def get_settings():
    """获取系统配置"""
    all_settings = await db_manager.get_all_settings()
    logo_path = all_settings.get("logo_path", "")
    logo_url = None
    if logo_path:
        logo_url = f"/static/logo/{logo_path}"
    return SettingsResponse(
        system_name=all_settings.get("system_name", "矩阵-知识库管理系统"),
        system_version=all_settings.get("system_version", "v1.02"),
        llm_base_url=all_settings.get("llm_base_url", ""),
        llm_api_key=_mask_api_key(all_settings.get("llm_api_key", "")),
        llm_model_name=all_settings.get("llm_model_name", ""),
        logo_url=logo_url,
        graph_max_gleanings=int(all_settings.get("graph_max_gleanings", "1")),
        graph_dedup_enabled=all_settings.get("graph_dedup_enabled", "true").lower() in ("true", "1"),
        graph_confidence_filter=all_settings.get("graph_confidence_filter", "true").lower() in ("true", "1"),
        graph_confidence_threshold=float(all_settings.get("graph_confidence_threshold", "0.6")),
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(data: SettingsUpdate):
    """更新系统配置"""
    updates = data.model_dump(exclude_none=True)
    # 如果更新了 llm_api_key，需要保存完整值（不脱敏）
    for key, value in updates.items():
        # 确保 bool 转为字符串存储
        if isinstance(value, bool):
            await db_manager.set_setting(key, str(value).lower())
        else:
            await db_manager.set_setting(key, str(value))
    return await get_settings()


@router.post("/logo")
async def upload_logo(file: UploadFile = File(...)):
    """上传自定义 logo"""
    # 支持的格式
    allowed_types = {"image/png", "image/jpeg", "image/svg+xml"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式，仅支持 png/jpg/svg",
        )

    # 确保目录存在
    LOGO_DIR.mkdir(parents=True, exist_ok=True)

    # 清理旧 logo
    for old_file in LOGO_DIR.iterdir():
        if old_file.is_file():
            old_file.unlink()

    # 保存新文件
    filename = file.filename or "logo.png"
    dest = LOGO_DIR / filename
    with open(dest, "wb") as f:
        content = await file.read()
        f.write(content)

    # 更新数据库中的 logo_path
    await db_manager.set_setting("logo_path", filename)

    logger.info("Logo 上传成功: %s", filename)
    return {"logo_url": f"/static/logo/{filename}"}


@router.get("/logo")
async def get_logo():
    """获取当前 logo 文件信息"""
    logo_path = await db_manager.get_setting("logo_path")
    if not logo_path:
        return {"logo_url": None}
    return {"logo_url": f"/static/logo/{logo_path}"}