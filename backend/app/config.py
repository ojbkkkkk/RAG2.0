"""RAG2.0 配置管理模块 — 使用 Pydantic Settings"""

from __future__ import annotations

import platform
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# ── 版本号 ──────────────────────────────────────────────────
VERSION = "1.0.3"


def _detect_device() -> str:
    """自动检测最佳计算设备：MPS（Apple Silicon）> CUDA > CPU"""
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


class Settings(BaseSettings):
    """应用全局配置，支持环境变量和 .env 文件覆盖"""

    model_config = SettingsConfigDict(
        env_prefix="RAG2_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── 路径配置 ────────────────────────────────────────────
    BASE_DIR: Path = Path(__file__).resolve().parent.parent  # backend/
    DATA_DIR: Path = Path("")  # 将在 model_post_init 中设为 BASE_DIR / "data"
    CHROMA_DIR: Path = Path("")  # 将在 model_post_init 中设为 DATA_DIR / "chroma"
    SQLITE_PATH: Path = Path("")  # 将在 model_post_init 中设为 DATA_DIR / "metadata.db"
    MARKDOWN_DIR: Path = Path("")  # 将在 model_post_init 中设为 DATA_DIR / "markdown"
    MARKDOWN_DIR: Path = Path("")  # 将在 model_post_init 中设为 DATA_DIR / "markdown"

    # ── 模型配置 ────────────────────────────────────────────
    MODEL_NAME: str = "BAAI/bge-m3"
    DEVICE: str = ""  # 将在 model_post_init 中自动检测
    USE_FP16: bool = True
    EMBEDDING_BATCH_SIZE: int = 12

    # ── 分块配置 ────────────────────────────────────────────
    CHUNK_SIZE: int = 512
    CHUNK_OVERLAP: int = 50

    # ── 检索配置 ────────────────────────────────────────────
    DEFAULT_TOP_K: int = 5
    DEFAULT_SCORE_THRESHOLD: float = 0.0

    # ── LLM 配置（知识图谱实体提取）────────────────────────
    LLM_BASE_URL: str = "https://api.openai.com"
    LLM_API_KEY: str = ""
    LLM_MODEL: str = "gpt-4o-mini"
    LLM_TEMPERATURE: float = 0.3
    LLM_MAX_TOKENS: int = 2000
    GRAPH_EXTRACTION_BATCH_SIZE: int = 5

    def model_post_init(self, __context: object) -> None:
        """在模型初始化后设置派生路径和设备"""
        # 路径
        if not self.DATA_DIR or self.DATA_DIR == Path(""):
            self.DATA_DIR = self.BASE_DIR / "data"
        if not self.CHROMA_DIR or self.CHROMA_DIR == Path(""):
            self.CHROMA_DIR = self.DATA_DIR / "chroma"
        if not self.SQLITE_PATH or self.SQLITE_PATH == Path(""):
            self.SQLITE_PATH = self.DATA_DIR / "metadata.db"
        if not self.MARKDOWN_DIR or self.MARKDOWN_DIR == Path(""):
            self.MARKDOWN_DIR = self.DATA_DIR / "markdown"
        # 设备
        if not self.DEVICE:
            self.DEVICE = _detect_device()


# 全局单例
settings = Settings()
