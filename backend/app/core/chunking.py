"""RAG2.0 分块策略 — RecursiveCharacter（通用） + MarkdownHeader（Markdown 专用）"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class Chunk:
    """分块结果数据结构"""

    content: str
    metadata: dict[str, Any] = field(default_factory=dict)
    chunk_index: int = 0


# ── Markdown 标题层级配置 ─────────────────────────────────────

_MARKDOWN_HEADERS_TO_SPLIT_ON: list[tuple[str, str]] = [
    ("#", "h1"),
    ("##", "h2"),
    ("###", "h3"),
    ("####", "h4"),
]


def _build_recursive_splitter(
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> RecursiveCharacterTextSplitter:
    """构建 RecursiveCharacterTextSplitter 实例"""
    return RecursiveCharacterTextSplitter(
        chunk_size=chunk_size or settings.CHUNK_SIZE,
        chunk_overlap=chunk_overlap or settings.CHUNK_OVERLAP,
        length_function=len,
        separators=["\n\n", "\n", "。", ".", " ", ""],
    )


def _build_markdown_splitter() -> MarkdownHeaderTextSplitter:
    """构建 MarkdownHeaderTextSplitter 实例"""
    return MarkdownHeaderTextSplitter(
        headers_to_split_on=_MARKDOWN_HEADERS_TO_SPLIT_ON,
        return_each_line=False,
    )


def _split_recursive(
    text: str, metadata: dict[str, Any], chunk_size: int | None = None, chunk_overlap: int | None = None
) -> list[Chunk]:
    """使用 RecursiveCharacterTextSplitter 分块"""
    splitter = _build_recursive_splitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    docs = splitter.create_documents([text], metadatas=[metadata])
    return [
        Chunk(
            content=doc.page_content,
            metadata={**doc.metadata, **metadata},
            chunk_index=i,
        )
        for i, doc in enumerate(docs)
    ]


def _split_markdown(
    text: str, metadata: dict[str, Any], chunk_size: int | None = None, chunk_overlap: int | None = None
) -> list[Chunk]:
    """使用 MarkdownHeaderTextSplitter 分块

    先按标题层级拆分，再对每个片段做 RecursiveCharacter 细分（超过 chunk_size 时）
    """
    md_splitter = _build_markdown_splitter()
    md_docs = md_splitter.split_text(text)

    # 对超过 chunk_size 的片段进一步细分
    recursive_splitter = _build_recursive_splitter(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    effective_chunk_size = chunk_size or settings.CHUNK_SIZE
    chunks: list[Chunk] = []
    chunk_idx = 0

    for md_doc in md_docs:
        combined_meta = {**md_doc.metadata, **metadata}
        content = md_doc.page_content if hasattr(md_doc, "page_content") else str(md_doc)

        if len(content) > effective_chunk_size:
            sub_docs = recursive_splitter.create_documents(
                [content], metadatas=[combined_meta]
            )
            for sub_doc in sub_docs:
                chunks.append(
                    Chunk(
                        content=sub_doc.page_content,
                        metadata={**sub_doc.metadata, **combined_meta},
                        chunk_index=chunk_idx,
                    )
                )
                chunk_idx += 1
        else:
            chunks.append(
                Chunk(
                    content=content,
                    metadata=combined_meta,
                    chunk_index=chunk_idx,
                )
            )
            chunk_idx += 1

    return chunks


# ── 统一接口 ──────────────────────────────────────────────────


def chunk_text(
    text: str,
    metadata: dict[str, Any] | None = None,
    strategy: str = "recursive",
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> list[Chunk]:
    """统一分块接口

    Args:
        text: 待分块文本
        metadata: 来源元数据（文档名、页码等）
        strategy: 分块策略 — "recursive"（通用）或 "markdown"（Markdown 专用）
        chunk_size: 分块大小，不传则使用全局默认值
        chunk_overlap: 分块重叠，不传则使用全局默认值

    Returns:
        分块结果列表
    """
    meta = metadata or {}

    if strategy == "markdown":
        logger.debug("使用 Markdown 分块策略, chunk_size=%s, chunk_overlap=%s", chunk_size, chunk_overlap)
        return _split_markdown(text, meta, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    logger.debug("使用 RecursiveCharacter 分块策略, chunk_size=%s, chunk_overlap=%s", chunk_size, chunk_overlap)
    return _split_recursive(text, meta, chunk_size=chunk_size, chunk_overlap=chunk_overlap)
