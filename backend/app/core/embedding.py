"""RAG2.0 BGE-M3 Embedding 封装 — 单例懒加载，支持 MPS/CUDA/CPU"""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings

logger = logging.getLogger(__name__)


class EmbeddingModel:
    """BGE-M3 嵌入模型封装（单例懒加载）

    首次调用 encode_texts / encode_query 时自动加载模型，
    后续调用直接复用已加载的模型实例。
    """

    _instance: EmbeddingModel | None = None
    _model: Any = None  # FlagModel 实例

    def __new__(cls) -> EmbeddingModel:
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    # ── 懒加载 ──────────────────────────────────────────────

    def _load_model(self) -> None:
        """加载 BGE-M3 模型（仅首次调用时执行）"""
        if self._model is not None:
            return

        logger.info("正在加载 BGE-M3 模型: %s, 设备: %s", settings.MODEL_NAME, settings.DEVICE)
        from FlagEmbedding import BGEM3FlagModel

        self._model = BGEM3FlagModel(
            settings.MODEL_NAME,
            use_fp16=settings.USE_FP16,
            device=settings.DEVICE,
        )
        logger.info("BGE-M3 模型加载完成")

    # ── 公开接口 ─────────────────────────────────────────────

    def encode_texts(self, texts: list[str]) -> dict[str, Any]:
        """对文本列表进行编码，返回 dense 和 sparse 向量

        Args:
            texts: 待编码文本列表

        Returns:
            {"dense": np.ndarray, "sparse": dict}
            - dense: shape (len(texts), 1024)
            - sparse: 字典形式稀疏表示
        """
        try:
            self._load_model()
        except Exception as e:
            logger.warning("Embedding 模型加载失败，使用随机向量 fallback: %s", e)
            return self._random_fallback(len(texts))

        logger.debug("编码 %d 条文本", len(texts))
        try:
            output = self._model.encode(
                texts,
                batch_size=settings.EMBEDDING_BATCH_SIZE,
                return_dense=True,
                return_sparse=True,
                return_colbert_vecs=False,
            )
            return {
                "dense": output["dense_vecs"],
                "sparse": output["lexical_weights"],
            }
        except Exception as e:
            logger.warning("Embedding 编码失败，使用随机向量 fallback: %s", e)
            return self._random_fallback(len(texts))

    def encode_query(self, query: str) -> dict[str, Any]:
        """对单条查询文本进行编码

        Args:
            query: 查询文本

        Returns:
            {"dense": np.ndarray, "sparse": dict}
            - dense: shape (1, 1024)
            - sparse: 字典形式稀疏表示
        """
        try:
            self._load_model()
        except Exception as e:
            logger.warning("Embedding 模型加载失败，使用随机向量 fallback: %s", e)
            return self._random_fallback(1)

        logger.debug("编码查询: %s", query[:50])
        try:
            output = self._model.encode(
                [query],
                batch_size=1,
                return_dense=True,
                return_sparse=True,
                return_colbert_vecs=False,
            )
            return {
                "dense": output["dense_vecs"],
                "sparse": output["lexical_weights"],
            }
        except Exception as e:
            logger.warning("Embedding 编码失败，使用随机向量 fallback: %s", e)
            return self._random_fallback(1)

    def _random_fallback(self, num: int) -> dict[str, Any]:
        """当模型不可用时返回随机向量（仅用于开发测试）"""
        import numpy as np

        logger.warning("生成 %d 条随机向量作为 fallback（仅限开发测试）", num)
        dense = np.random.randn(num, 1024).astype(np.float32)
        dense = dense / np.linalg.norm(dense, axis=1, keepdims=True)
        return {"dense": dense, "sparse": {}}

    @property
    def is_loaded(self) -> bool:
        """模型是否已加载"""
        return self._model is not None


# 全局单例
embedding_model = EmbeddingModel()
