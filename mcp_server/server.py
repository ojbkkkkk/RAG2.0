"""RAG2.0 MCP Server 核心 — 通过 stdio 协议提供 RAG 知识库工具"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# ── 路径设置：确保能导入 backend.app 模块 ───────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_BACKEND_ROOT = _PROJECT_ROOT / "backend"
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.core.retriever import search as retriever_search, graph_search
from app.db.database import db_manager

# ── 检索模式配置 ────────────────────────────────────────────
# 支持："vector"（默认）、"graph"、"hybrid"
RETRIEVAL_MODE = os.environ.get("RAG2_RETRIEVAL_MODE", "vector")

# 可选：限制 MCP 可访问的知识库范围，多个名称用逗号分隔
_COLLECTIONS_RAW = os.environ.get("RAG2_COLLECTIONS", "")
ALLOWED_COLLECTIONS = {
    name.strip()
    for name in _COLLECTIONS_RAW.split(",")
    if name.strip()
}

# 混合检索融合权重
_VECTOR_WEIGHT = 0.6
_GRAPH_WEIGHT = 0.4

logger = logging.getLogger(__name__)

# ── MCP Server 实例 ────────────────────────────────────────────

server = Server("rag-knowledge-base")

# ── 数据库初始化标记 ───────────────────────────────────────────

_db_initialized = False


async def _ensure_db() -> None:
    """确保数据库已初始化"""
    global _db_initialized
    if not _db_initialized:
        await db_manager.init()
        _db_initialized = True


def _is_collection_allowed(collection_name: str | None) -> bool:
    """检查集合名称是否在 MCP 白名单内；未配置白名单时允许全部。"""
    return not ALLOWED_COLLECTIONS or collection_name in ALLOWED_COLLECTIONS


def _filter_allowed_collections(collections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """按 RAG2_COLLECTIONS 过滤集合列表。"""
    if not ALLOWED_COLLECTIONS:
        return collections
    return [coll for coll in collections if coll.get("name") in ALLOWED_COLLECTIONS]


# ── 工具定义 ──────────────────────────────────────────────────


@server.list_tools()
async def list_tools() -> list[Tool]:
    """列出所有可用的 MCP 工具"""
    return [
        Tool(
            name="search_knowledge",
            description=(
                "Search the local RAG knowledge base. Supports three retrieval modes: "
                "vector (semantic similarity), graph (knowledge graph relations), "
                "hybrid (combined vector + graph). Default mode is controlled by "
                "RAG2_RETRIEVAL_MODE environment variable."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query text",
                    },
                    "collection_name": {
                        "type": "string",
                        "description": "Specific collection name to search in. If not provided, searches all collections.",
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Number of results to return",
                        "default": 5,
                    },
                    "score_threshold": {
                        "type": "number",
                        "description": "Minimum similarity score threshold (0-1)",
                        "default": 0.3,
                    },
                    "retrieval_mode": {
                        "type": "string",
                        "enum": ["vector", "graph", "hybrid"],
                        "description": "检索模式，覆盖环境变量配置。vector=向量检索，graph=图谱检索，hybrid=混合检索",
                    },
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="list_collections",
            description=(
                "List all available knowledge base collections with their statistics."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="get_document_chunks",
            description=(
                "Get all text chunks of a specific document by document ID."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "document_id": {
                        "type": "string",
                        "description": "The document ID to retrieve chunks for",
                    },
                },
                "required": ["document_id"],
            },
        ),
        Tool(
            name="get_collection_stats",
            description=(
                "Get detailed statistics of a specific knowledge base collection."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "collection_name": {
                        "type": "string",
                        "description": "The collection name to get stats for",
                    },
                },
                "required": ["collection_name"],
            },
        ),
    ]


# ── 工具调用处理 ──────────────────────────────────────────────


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """处理工具调用"""
    await _ensure_db()

    try:
        if name == "search_knowledge":
            return await _handle_search_knowledge(arguments)
        elif name == "list_collections":
            return await _handle_list_collections()
        elif name == "get_document_chunks":
            return await _handle_get_document_chunks(arguments)
        elif name == "get_collection_stats":
            return await _handle_get_collection_stats(arguments)
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    except Exception as e:
        logger.exception("Tool '%s' execution failed", name)
        return [TextContent(type="text", text=f"Error executing tool '{name}': {e}")]


# ── 工具实现 ──────────────────────────────────────────────────


async def _handle_search_knowledge(arguments: dict[str, Any]) -> list[TextContent]:
    """实现 search_knowledge 工具，支持 vector / graph / hybrid 三种检索模式"""
    query = arguments["query"]
    collection_name = arguments.get("collection_name")
    top_k = arguments.get("top_k", 5)
    score_threshold = arguments.get("score_threshold", 0.3)
    # 优先使用调用方传入的模式，否则使用环境变量配置
    mode = arguments.get("retrieval_mode") or RETRIEVAL_MODE

    if mode == "graph":
        all_results = await _search_graph(query, collection_name, top_k, score_threshold)
    elif mode == "hybrid":
        all_results = await _search_hybrid(
            query, collection_name, top_k, score_threshold,
            use_vector=True, use_graph=True,
        )
    else:
        # 默认向量检索
        all_results = await _search_vector(query, collection_name, top_k, score_threshold)

    if not all_results:
        return [TextContent(
            type="text",
            text=f"No results found for query: '{query}' (mode: {mode})",
        )]

    # 格式化输出
    lines = [f"## Search Results for: \"{query}\" (mode: {mode})\n"]
    for i, r in enumerate(all_results, 1):
        lines.append(f"### Result {i} (Score: {r['score']:.4f})")
        lines.append(f"**Document:** {r.get('document_filename', 'Unknown')}")
        if r.get("collection_name"):
            lines.append(f"**Collection:** {r['collection_name']}")
        lines.append(f"**Document ID:** {r['document_id']}")
        lines.append(f"**Chunk Index:** {r['chunk_index']}")
        # hybrid 模式展示分项分数
        meta = r.get("metadata", {})
        if meta.get("source") == "hybrid":
            lines.append(
                f"**Vector Score:** {meta.get('vector_score', 0):.4f}  "
                f"**Graph Score:** {meta.get('graph_score', 0):.4f}"
            )
        if meta.get("matched_entities"):
            lines.append(f"**Matched Entities:** {', '.join(meta['matched_entities'])}")
        lines.append(f"\n{r['content']}\n")
        lines.append("---")

    return [TextContent(type="text", text="\n".join(lines))]


# ── 检索模式子实现 ─────────────────────────────────────────────


async def _search_vector(
    query: str,
    collection_name: str | None,
    top_k: int,
    score_threshold: float,
) -> list[dict[str, Any]]:
    """向量检索"""
    all_results: list[dict[str, Any]] = []

    if collection_name:
        if not _is_collection_allowed(collection_name):
            return []
        chroma_name = await db_manager.get_chroma_name_by_display_name(collection_name)
        if chroma_name is None:
            return []
        results = await retriever_search(
            query=query,
            collection_name=chroma_name,
            top_k=top_k,
            score_threshold=score_threshold,
        )
        for r in results:
            doc_info = await db_manager.get_document(r.document_id)
            item = {
                "content": r.content,
                "score": r.score,
                "document_id": r.document_id,
                "chunk_index": r.chunk_index,
                "metadata": r.metadata,
            }
            if doc_info:
                item["document_filename"] = doc_info.get("filename", "")
                item["document_file_type"] = doc_info.get("file_type", "")
            all_results.append(item)
    else:
        collections = _filter_allowed_collections(await db_manager.list_collections())
        for coll in collections:
            try:
                chroma_name = coll.get("chroma_name") or coll["name"]
                results = await retriever_search(
                    query=query,
                    collection_name=chroma_name,
                    top_k=top_k,
                    score_threshold=score_threshold,
                )
                for r in results:
                    doc_info = await db_manager.get_document(r.document_id)
                    item = {
                        "content": r.content,
                        "score": r.score,
                        "document_id": r.document_id,
                        "chunk_index": r.chunk_index,
                        "metadata": r.metadata,
                        "collection_name": coll["name"],
                    }
                    if doc_info:
                        item["document_filename"] = doc_info.get("filename", "")
                        item["document_file_type"] = doc_info.get("file_type", "")
                    all_results.append(item)
            except Exception as e:
                logger.warning("向量检索失败 (collection=%s): %s", coll["name"], e)
                continue
        all_results.sort(key=lambda x: x["score"], reverse=True)
        all_results = all_results[:top_k]

    return all_results


async def _search_graph(
    query: str,
    collection_name: str | None,
    top_k: int,
    score_threshold: float,
) -> list[dict[str, Any]]:
    """图谱检索"""
    all_results: list[dict[str, Any]] = []

    if collection_name:
        if not _is_collection_allowed(collection_name):
            return []
        coll = await db_manager.get_collection_by_name(collection_name)
        if coll is None:
            return []
        items = await _graph_search_collection(
            query=query,
            collection_id=coll["id"],
            top_k=top_k,
            score_threshold=score_threshold,
        )
        all_results.extend(items)
    else:
        collections = _filter_allowed_collections(await db_manager.list_collections())
        for coll in collections:
            try:
                items = await _graph_search_collection(
                    query=query,
                    collection_id=coll["id"],
                    top_k=top_k,
                    score_threshold=score_threshold,
                )
                for item in items:
                    item.setdefault("collection_name", coll["name"])
                all_results.extend(items)
            except Exception as e:
                logger.warning("图谱检索失败 (collection=%s): %s", coll["name"], e)
                continue
        all_results.sort(key=lambda x: x["score"], reverse=True)
        all_results = all_results[:top_k]

    return all_results


async def _graph_search_collection(
    query: str,
    collection_id: str,
    top_k: int,
    score_threshold: float,
) -> list[dict[str, Any]]:
    """对单个知识库执行图谱检索，返回 dict 列表"""
    graph_results = await graph_search(
        query=query,
        collection_id=collection_id,
        top_k=top_k * 2,
    )
    if not graph_results:
        return []

    graph_chunk_ids = [g["chunk_id"] for g in graph_results]
    chunks_data = await db_manager.get_chunks_by_ids(graph_chunk_ids)
    chunks_map = {c["id"]: c for c in chunks_data}

    results: list[dict[str, Any]] = []
    for g in graph_results:
        cid = g["chunk_id"]
        graph_score = g["graph_score"]
        matched_entities = g.get("matched_entities", [])
        chunk_data = chunks_map.get(cid)
        if not chunk_data or graph_score < score_threshold:
            continue
        doc_info = await db_manager.get_document(chunk_data["document_id"])
        meta = {**chunk_data.get("metadata", {}), "source": "graph",
                "graph_score": graph_score, "matched_entities": matched_entities}
        if doc_info:
            meta["document_filename"] = doc_info.get("filename", "")
            meta["document_file_type"] = doc_info.get("file_type", "")
        results.append({
            "content": chunk_data["content"],
            "score": graph_score,
            "document_id": chunk_data["document_id"],
            "chunk_index": chunk_data["chunk_index"],
            "metadata": meta,
            "document_filename": meta.get("document_filename", ""),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


async def _search_hybrid(
    query: str,
    collection_name: str | None,
    top_k: int,
    score_threshold: float,
    use_vector: bool = True,
    use_graph: bool = True,
) -> list[dict[str, Any]]:
    """混合检索（向量 + 图谱融合）"""
    all_results: list[dict[str, Any]] = []

    if collection_name:
        if not _is_collection_allowed(collection_name):
            return []
        coll = await db_manager.get_collection_by_name(collection_name)
        if coll is None:
            return []
        items = await _hybrid_search_collection(
            query=query,
            collection_id=coll["id"],
            chroma_name=coll.get("chroma_name") or coll["name"],
            use_vector=use_vector,
            use_graph=use_graph,
            top_k=top_k,
            score_threshold=score_threshold,
        )
        all_results.extend(items)
    else:
        collections = _filter_allowed_collections(await db_manager.list_collections())
        for coll in collections:
            try:
                chroma_name = coll.get("chroma_name") or coll["name"]
                items = await _hybrid_search_collection(
                    query=query,
                    collection_id=coll["id"],
                    chroma_name=chroma_name,
                    use_vector=use_vector,
                    use_graph=use_graph,
                    top_k=top_k,
                    score_threshold=score_threshold,
                )
                for item in items:
                    item.setdefault("collection_name", coll["name"])
                all_results.extend(items)
            except Exception as e:
                logger.warning("混合检索失败 (collection=%s): %s", coll["name"], e)
                continue
        all_results.sort(key=lambda x: x["score"], reverse=True)
        all_results = all_results[:top_k]

    return all_results


async def _hybrid_search_collection(
    query: str,
    collection_id: str,
    chroma_name: str,
    use_vector: bool,
    use_graph: bool,
    top_k: int,
    score_threshold: float,
) -> list[dict[str, Any]]:
    """对单个知识库执行混合检索，返回 dict 列表"""
    merged: dict[str, dict] = {}

    # 1. 向量检索
    if use_vector:
        try:
            vector_results = await retriever_search(
                query=query,
                collection_name=chroma_name,
                top_k=top_k * 2,
                score_threshold=0.0,
            )
            for r in vector_results:
                chunk_key = f"{r.document_id}_{r.chunk_index}"
                chunk_id = r.metadata.get("chunk_id", chunk_key)
                merged[chunk_id] = {
                    "vector_score": r.score,
                    "graph_score": 0.0,
                    "content": r.content,
                    "metadata": {**r.metadata},
                    "document_id": r.document_id,
                    "chunk_index": r.chunk_index,
                    "chunk_key": chunk_key,
                }
        except Exception as e:
            logger.warning("向量检索失败 (collection=%s): %s", chroma_name, e)

    # 2. 图谱检索
    if use_graph:
        try:
            graph_results = await graph_search(
                query=query,
                collection_id=collection_id,
                top_k=top_k * 2,
            )
            if graph_results:
                graph_chunk_ids = [g["chunk_id"] for g in graph_results]
                chunks_data = await db_manager.get_chunks_by_ids(graph_chunk_ids)
                chunks_map = {c["id"]: c for c in chunks_data}
                for g in graph_results:
                    cid = g["chunk_id"]
                    graph_score = g["graph_score"]
                    matched_entities = g.get("matched_entities", [])
                    chunk_data = chunks_map.get(cid)
                    if cid in merged:
                        merged[cid]["graph_score"] = max(merged[cid]["graph_score"], graph_score)
                        merged[cid]["metadata"]["matched_entities"] = matched_entities
                    elif chunk_data:
                        merged[cid] = {
                            "vector_score": 0.0,
                            "graph_score": graph_score,
                            "content": chunk_data["content"],
                            "metadata": {
                                **chunk_data.get("metadata", {}),
                                "matched_entities": matched_entities,
                            },
                            "document_id": chunk_data["document_id"],
                            "chunk_index": chunk_data["chunk_index"],
                            "chunk_key": f"{chunk_data['document_id']}_{chunk_data['chunk_index']}",
                        }
        except Exception as e:
            logger.warning("图谱检索失败 (collection=%s): %s", collection_id, e)

    # 3. 去重 + 融合分数
    deduped: dict[str, dict] = {}
    for cid, info in merged.items():
        key = info["chunk_key"]
        if key not in deduped:
            deduped[key] = info
        else:
            deduped[key]["vector_score"] = max(deduped[key]["vector_score"], info["vector_score"])
            deduped[key]["graph_score"] = max(deduped[key]["graph_score"], info["graph_score"])

    results: list[dict[str, Any]] = []
    for info in deduped.values():
        combined_score = round(
            _VECTOR_WEIGHT * info["vector_score"] + _GRAPH_WEIGHT * info["graph_score"], 4
        )
        if combined_score < score_threshold:
            continue
        doc_info = await db_manager.get_document(info["document_id"])
        meta = {**info["metadata"], "source": "hybrid",
                "vector_score": info["vector_score"], "graph_score": info["graph_score"]}
        if doc_info:
            meta["document_filename"] = doc_info.get("filename", "")
            meta["document_file_type"] = doc_info.get("file_type", "")
        results.append({
            "content": info["content"],
            "score": combined_score,
            "document_id": info["document_id"],
            "chunk_index": info["chunk_index"],
            "metadata": meta,
            "document_filename": meta.get("document_filename", ""),
        })

    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]


async def _handle_list_collections() -> list[TextContent]:
    """实现 list_collections 工具"""
    collections = _filter_allowed_collections(await db_manager.list_collections())

    if not collections:
        return [TextContent(type="text", text="No collections found.")]

    lines = ["## Knowledge Base Collections\n"]
    for coll in collections:
        lines.append(f"- **{coll['name']}**")
        lines.append(f"  - ID: `{coll['id']}`")
        lines.append(f"  - Description: {coll.get('description', 'N/A')}")
        lines.append(f"  - Documents: {coll.get('document_count', 0)}")
        lines.append(f"  - Chunks: {coll.get('chunk_count', 0)}")
        lines.append(f"  - Created: {coll.get('created_at', 'N/A')}")
        lines.append("")

    return [TextContent(type="text", text="\n".join(lines))]


async def _handle_get_document_chunks(arguments: dict[str, Any]) -> list[TextContent]:
    """实现 get_document_chunks 工具"""
    document_id = arguments["document_id"]

    doc = await db_manager.get_document(document_id)
    if doc is None:
        return [TextContent(
            type="text",
            text=f"Document not found: {document_id}",
        )]
    coll = await db_manager.get_collection(doc["collection_id"])
    if coll is not None and not _is_collection_allowed(coll["name"]):
        return [TextContent(
            type="text",
            text=f"Document not available in configured MCP collections: {document_id}",
        )]

    chunks = await db_manager.get_chunks_by_document(document_id)

    lines = [f"## Chunks for Document: {doc['filename']}\n"]
    lines.append(f"**Document ID:** `{document_id}`")
    lines.append(f"**File Type:** {doc.get('file_type', 'N/A')}")
    lines.append(f"**Status:** {doc.get('status', 'N/A')}")
    lines.append(f"**Total Chunks:** {len(chunks)}\n")
    lines.append("---")

    for chunk in chunks:
        lines.append(f"\n### Chunk {chunk['chunk_index']}")
        lines.append(f"**Chunk ID:** `{chunk['id']}`")
        metadata = chunk.get("metadata_json", {})
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except (json.JSONDecodeError, TypeError):
                metadata = {}
        if metadata:
            lines.append(f"**Metadata:** {json.dumps(metadata, ensure_ascii=False, indent=2)}")
        lines.append(f"\n{chunk['content']}\n")
        lines.append("---")

    return [TextContent(type="text", text="\n".join(lines))]


async def _handle_get_collection_stats(arguments: dict[str, Any]) -> list[TextContent]:
    """实现 get_collection_stats 工具"""
    collection_name = arguments["collection_name"]

    coll = await db_manager.get_collection_by_name(collection_name)
    if coll is None:
        return [TextContent(
            type="text",
            text=f"Collection not found: {collection_name}",
        )]
    if not _is_collection_allowed(collection_name):
        return [TextContent(
            type="text",
            text=f"Collection not available in configured MCP collections: {collection_name}",
        )]

    documents = await db_manager.list_documents(coll["id"])

    lines = [f"## Collection Stats: {collection_name}\n"]
    lines.append(f"**Collection ID:** `{coll['id']}`")
    lines.append(f"**Description:** {coll.get('description', 'N/A')}")
    lines.append(f"**Total Documents:** {coll.get('document_count', 0)}")
    lines.append(f"**Total Chunks:** {coll.get('chunk_count', 0)}")
    lines.append(f"**Created At:** {coll.get('created_at', 'N/A')}")

    if documents:
        lines.append(f"\n### Documents ({len(documents)})\n")
        for doc in documents:
            status_emoji = {"ready": "✅", "processing": "⏳", "error": "❌"}.get(
                doc.get("status", ""), ""
            )
            lines.append(
                f"- **{doc['filename']}** {status_emoji}\n"
                f"  - ID: `{doc['id']}`\n"
                f"  - Type: {doc.get('file_type', 'N/A')}\n"
                f"  - Size: {doc.get('file_size', 0)} bytes\n"
                f"  - Chunks: {doc.get('chunk_count', 0)}\n"
                f"  - Status: {doc.get('status', 'N/A')}"
            )

    return [TextContent(type="text", text="\n".join(lines))]


# ── 服务器启动 ────────────────────────────────────────────────


async def main() -> None:
    """启动 MCP Server（stdio 模式）"""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )
