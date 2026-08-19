"""RAG2.0 API 路由模块"""

from .collections import router as collections_router
from .documents import router as documents_router
from .search import router as search_router

__all__ = ["collections_router", "documents_router", "search_router"]
