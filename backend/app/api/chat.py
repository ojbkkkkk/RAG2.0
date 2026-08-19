"""RAG2.0 智能问答 Chat API — SSE 流式输出"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.core.llm import stream_chat_completion
from app.core.retriever import SearchResult, graph_search, search as retriever_search
from app.db.database import db_manager
from app.models.schemas import ChatRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/chat", tags=["chat"])

# ── RAG System Prompt ───────────────────────────────────────────

_SYSTEM_PROMPT = """你是一个智能知识库助手。请根据以下参考资料回答用户的问题。
如果参考资料中没有相关信息，请如实说明你不确定，不要编造答案。
回答时请尽量准确、简洁，并在适当时引用来源。"""


# ── 检索 ─────────────────────────────────────────────────────────


async def _retrieve_context(
    query: str,
    collection_name: str | None,
    use_hybrid: bool,
    top_k: int,
) -> list[SearchResult]:
    """根据查询获取检索结果

    如果指定了 collection_name，则在该知识库检索；
    否则搜索所有知识库，汇总后按分数截取 top_k。
    """
    all_results: list[SearchResult] = []

    if collection_name:
        # 在指定知识库检索：将用户显示名映射为 chroma_name
        chroma_name = await db_manager.get_chroma_name_by_display_name(collection_name)
        if chroma_name is None:
            logger.warning("知识库 '%s' 不存在，跳过检索", collection_name)
            return []

        if use_hybrid:
            # 混合检索：先向量检索，再图谱检索，融合排序
            coll = await db_manager.get_collection_by_name(collection_name)
            if coll:
                all_results = await _hybrid_retrieve(
                    query=query,
                    collection_id=coll["id"],
                    chroma_name=chroma_name,
                    top_k=top_k,
                )
            else:
                all_results = await retriever_search(
                    query=query,
                    collection_name=chroma_name,
                    top_k=top_k,
                )
        else:
            all_results = await retriever_search(
                query=query,
                collection_name=chroma_name,
                top_k=top_k,
            )
    else:
        # 搜索所有知识库
        collections = await db_manager.list_collections()
        for coll in collections:
            try:
                chroma_name = coll.get("chroma_name") or coll["name"]
                if use_hybrid:
                    results = await _hybrid_retrieve(
                        query=query,
                        collection_id=coll["id"],
                        chroma_name=chroma_name,
                        top_k=top_k,
                    )
                else:
                    results = await retriever_search(
                        query=query,
                        collection_name=chroma_name,
                        top_k=top_k,
                    )
                all_results.extend(results)
            except Exception as e:
                logger.warning("在知识库 '%s' 中检索失败: %s", coll["name"], e)
                continue

        # 按分数降序排列，截取 top_k
        all_results.sort(key=lambda x: x.score, reverse=True)
        all_results = all_results[:top_k]

    return all_results


async def _hybrid_retrieve(
    query: str,
    collection_id: str,
    chroma_name: str,
    top_k: int,
) -> list[SearchResult]:
    """简化的混合检索：向量 + 图谱，融合排序"""
    # chunk_key -> {vector_score, graph_score, content, metadata, document_id, chunk_index}
    merged: dict[str, dict[str, Any]] = {}

    # 1. 向量检索
    try:
        vector_results = await retriever_search(
            query=query,
            collection_name=chroma_name,
            top_k=top_k * 2,
            score_threshold=0.0,
        )
        for r in vector_results:
            chunk_key = f"{r.document_id}_{r.chunk_index}"
            merged[chunk_key] = {
                "vector_score": r.score,
                "graph_score": 0.0,
                "content": r.content,
                "metadata": {**r.metadata},
                "document_id": r.document_id,
                "chunk_index": r.chunk_index,
            }
    except Exception as e:
        logger.warning("向量检索失败 (collection=%s): %s", chroma_name, e)

    # 2. 图谱检索
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

                if chunk_data:
                    chunk_key = f"{chunk_data['document_id']}_{chunk_data['chunk_index']}"
                    if chunk_key in merged:
                        merged[chunk_key]["graph_score"] = max(
                            merged[chunk_key]["graph_score"], graph_score
                        )
                        merged[chunk_key]["metadata"]["matched_entities"] = matched_entities
                    else:
                        merged[chunk_key] = {
                            "vector_score": 0.0,
                            "graph_score": graph_score,
                            "content": chunk_data["content"],
                            "metadata": {
                                **chunk_data.get("metadata", {}),
                                "matched_entities": matched_entities,
                            },
                            "document_id": chunk_data["document_id"],
                            "chunk_index": chunk_data["chunk_index"],
                        }
    except Exception as e:
        logger.warning("图谱检索失败 (collection=%s): %s", collection_id, e)

    # 3. 融合分数
    VECTOR_WEIGHT = 0.6
    GRAPH_WEIGHT = 0.4
    results: list[SearchResult] = []
    for info in merged.values():
        combined_score = round(
            VECTOR_WEIGHT * info["vector_score"] + GRAPH_WEIGHT * info["graph_score"],
            4,
        )
        results.append(
            SearchResult(
                content=info["content"],
                score=combined_score,
                metadata=info["metadata"],
                document_id=info["document_id"],
                chunk_index=info["chunk_index"],
            )
        )

    # 4. 按分数降序排列
    results.sort(key=lambda x: x.score, reverse=True)
    return results[:top_k]


# ── Prompt 构建 ──────────────────────────────────────────────────


def _build_messages(
    query: str,
    context_results: list[SearchResult],
    conversation_history: list[dict[str, str]],
) -> list[dict[str, str]]:
    """构建 LLM 消息列表：system prompt + context + history + query"""
    # 构建上下文文本
    context_parts: list[str] = []
    for i, r in enumerate(context_results, 1):
        source_info = f"（文档ID: {r.document_id}, 相似度: {r.score}）"
        context_parts.append(f"[参考资料 {i}] {source_info}\n{r.content}")

    context_text = "\n\n".join(context_parts) if context_parts else "（未找到相关参考资料）"

    system_content = f"{_SYSTEM_PROMPT}\n\n---\n\n【参考资料】\n{context_text}"

    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_content},
    ]

    # 对话历史
    for msg in conversation_history:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # 当前问题
    messages.append({"role": "user", "content": query})

    return messages


# ── SSE 事件生成 ─────────────────────────────────────────────────


async def _generate_sse_events(body: ChatRequest) -> AsyncGenerator[str, None]:
    """生成 SSE 事件流

    事件序列:
    1. event: context — 推送参考资料列表
    2. event: token  — 逐 token 推送 LLM 生成内容
    3. event: done   — 完成信号
    4. event: error  — 错误信号（异常时）
    """
    try:
        # 1. 检索相关上下文
        context_results = await _retrieve_context(
            query=body.query,
            collection_name=body.collection_name,
            use_hybrid=body.use_hybrid,
            top_k=body.top_k,
        )

        # 2. 推送 context 事件
        context_data = [
            {
                "content": r.content,
                "score": r.score,
                "document_id": r.document_id,
                "metadata": r.metadata,
            }
            for r in context_results
        ]
        yield f"event: context\ndata: {json.dumps(context_data, ensure_ascii=False)}\n\n"

        # 3. 构建 LLM 消息
        history_dicts = [
            {"role": m.role, "content": m.content}
            for m in body.conversation_history
        ]
        messages = _build_messages(
            query=body.query,
            context_results=context_results,
            conversation_history=history_dicts,
        )

        # 4. 流式调用 LLM，逐 token 推送
        async for token in stream_chat_completion(messages=messages):
            # SSE data 中需要转义换行
            escaped = json.dumps(token, ensure_ascii=False)
            yield f"event: token\ndata: {escaped}\n\n"

        # 5. 推送 done 事件
        yield "event: done\ndata: {}\n\n"

    except ValueError as e:
        # LLM 未配置等业务错误
        logger.warning("Chat 错误: %s", e)
        error_payload = json.dumps({"error": str(e)}, ensure_ascii=False)
        yield f"event: error\ndata: {error_payload}\n\n"
        yield "event: done\ndata: {}\n\n"

    except Exception as e:
        logger.exception("Chat 异常: %s", e)
        error_payload = json.dumps({"error": f"内部错误: {e}"}, ensure_ascii=False)
        yield f"event: error\ndata: {error_payload}\n\n"
        yield "event: done\ndata: {}\n\n"


# ── 路由 ─────────────────────────────────────────────────────────


@router.post("")
async def chat(body: ChatRequest):
    """智能问答 — SSE 流式返回

    流程：
    1. 检索相关 chunks（支持混合检索）
    2. 构建 RAG prompt
    3. 流式调用 LLM 生成回答
    """
    return StreamingResponse(
        _generate_sse_events(body),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 防止 Nginx 缓冲
        },
    )
