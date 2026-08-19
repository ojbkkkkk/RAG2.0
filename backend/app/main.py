"""RAG2.0 FastAPI 入口"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.chat import router as chat_router
from app.api.collections import router as collections_router
from app.api.documents import router as documents_router
from app.api.graph import router as graph_router
from app.api.search import router as search_router
from app.api.settings import router as settings_router
from app.api.integrations import router as integrations_router
from app.api.system import router as system_router
from app.api.vectorize import router as vectorize_router
from app.api.sync import router as sync_router
from app.config import settings, VERSION
from app.core.embedding import embedding_model
from app.core.sync_service import sync_service
from app.db.database import db_manager

# ── 日志配置 ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Lifespan ──────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动 / 关闭生命周期"""
    # ── Startup ──
    logger.info("RAG2.0 启动中...")
    logger.info("设备: %s | 模型: %s", settings.DEVICE, settings.MODEL_NAME)
    logger.info("数据目录: %s", settings.DATA_DIR)

    # 初始化数据库（SQLite + ChromaDB）
    await db_manager.init()
    logger.info("数据库初始化完成")

    # 预加载 embedding 模型（懒加载模式，此处仅日志提示）
    logger.info("Embedding 模型将在首次调用时加载（懒加载模式）")

    # 确保上传目录存在
    upload_dir = settings.DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    logger.info("上传目录: %s", upload_dir)

    # 确保 markdown 目录存在
    markdown_dir = settings.MARKDOWN_DIR
    markdown_dir.mkdir(parents=True, exist_ok=True)
    logger.info("Markdown 目录: %s", markdown_dir)

    # 确保静态文件目录存在
    static_dir = settings.DATA_DIR / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    logo_dir = static_dir / "logo"
    logo_dir.mkdir(parents=True, exist_ok=True)
    logger.info("静态文件目录: %s", static_dir)

    # 启动目录同步服务
    await sync_service.start()
    logger.info("目录同步服务已启动")

    yield

    # ── Shutdown ──
    logger.info("RAG2.0 关闭中...")
    await sync_service.stop()
    logger.info("目录同步服务已停止")
    await db_manager.close()
    logger.info("数据库连接已关闭")


# ── FastAPI App ──────────────────────────────────────────────

app = FastAPI(
    title="RAG知识库系统",
    description="RAG 2.0 — 文档解析、向量化、检索增强生成系统",
    version=VERSION,
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite 开发服务器（默认端口）
        "http://127.0.0.1:5173",
        "http://localhost:3000",  # Vite 开发服务器（自定义端口）
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 注册路由 ────────────────────────────────────────────────

app.include_router(collections_router)
app.include_router(documents_router)
app.include_router(search_router)
app.include_router(graph_router)
app.include_router(settings_router)
app.include_router(chat_router)
app.include_router(system_router)
app.include_router(integrations_router)
app.include_router(vectorize_router)
app.include_router(sync_router)

# ── 静态文件服务（logo 等）─────────────────────────────────────────
_static_dir = settings.DATA_DIR / "static"
_static_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


# ── 健康检查 ──────────────────────────────────────────────────


@app.get("/health", tags=["system"])
async def health_check():
    """健康检查端点"""
    return {
        "status": "ok",
        "device": settings.DEVICE,
        "model": settings.MODEL_NAME,
        "embedding_loaded": embedding_model.is_loaded,
    }
