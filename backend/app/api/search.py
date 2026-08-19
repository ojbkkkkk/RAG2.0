"""RAG2.0 检索 API"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.core.retriever import search as retriever_search
from app.core.retriever import graph_search
from app.db.database import db_manager
from app.models.schemas import (
    HybridSearchQuery,
    SearchQuery,
    SearchResultItem,
    SearchResponse,
)
from app.parsers import supported_extensions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/search", tags=["search"])


# ── 语义检索 ────────────────────────────────────────────────


@router.post("", response_model=SearchResponse)
async def search(body: SearchQuery):
    """语义检索

    - collection_name 不传则搜索所有知识库
    - 返回按相似度降序排列的 chunks 列表
    """
    all_results: list[SearchResultItem] = []

    if body.collection_name:
        # 在指定知识库中检索：将用户显示名映射为 chroma_name
        chroma_name = await db_manager.get_chroma_name_by_display_name(body.collection_name)
        if chroma_name is None:
            raise HTTPException(status_code=404, detail=f"知识库 '{body.collection_name}' 不存在")
        results = await retriever_search(
            query=body.query,
            collection_name=chroma_name,
            top_k=body.top_k,
            score_threshold=body.score_threshold,
        )
        for r in results:
            # 附加文档信息
            doc_info = await _get_document_info(r.document_id)
            meta = {**r.metadata}
            if doc_info:
                meta["document_filename"] = doc_info.get("filename", "")
                meta["document_file_type"] = doc_info.get("file_type", "")
            all_results.append(
                SearchResultItem(
                    content=r.content,
                    score=r.score,
                    metadata=meta,
                    document_id=r.document_id,
                    chunk_index=r.chunk_index,
                )
            )
    else:
        # 搜索所有知识库
        collections = await db_manager.list_collections()
        for coll in collections:
            try:
                chroma_name = coll.get("chroma_name") or coll["name"]
                results = await retriever_search(
                    query=body.query,
                    collection_name=chroma_name,
                    top_k=body.top_k,
                    score_threshold=body.score_threshold,
                )
                for r in results:
                    doc_info = await _get_document_info(r.document_id)
                    meta = {**r.metadata}
                    if doc_info:
                        meta["document_filename"] = doc_info.get("filename", "")
                        meta["document_file_type"] = doc_info.get("file_type", "")
                    all_results.append(
                        SearchResultItem(
                            content=r.content,
                            score=r.score,
                            metadata=meta,
                            document_id=r.document_id,
                            chunk_index=r.chunk_index,
                        )
                    )
            except Exception as e:
                logger.warning("在知识库 '%s' 中检索失败: %s", coll["name"], e)
                continue

        # 按分数降序排列，截取 top_k
        all_results.sort(key=lambda x: x.score, reverse=True)
        all_results = all_results[: body.top_k]

    return SearchResponse(
        query=body.query,
        results=all_results,
        total=len(all_results),
    )


async def _get_document_info(document_id: str) -> dict | None:
    """获取文档基本信息"""
    if not document_id:
        return None
    return await db_manager.get_document(document_id)


# ── 支持的文件格式 ──────────────────────────────────────────


@router.get("/supported-formats")
async def get_supported_formats():
    """返回支持的文件格式列表"""
    return {"formats": supported_extensions()}


# ── 混合检索 ────────────────────────────────────────────────


# 融合权重
_VECTOR_WEIGHT = 0.6
_GRAPH_WEIGHT = 0.4


@router.post("/hybrid", response_model=SearchResponse)
async def hybrid_search(body: HybridSearchQuery):
    """混合检索：结合向量相似度 + 图谱关系

    流程：
    1. 如果 use_vector=True: 执行向量检索获取 top_k*2 候选
    2. 如果 use_graph=True: 执行图谱检索获取相关chunks
    3. 融合：
       - 两个来源的chunks合并
       - 综合分数 = vector_weight * vector_score + graph_weight * graph_score
       - vector_weight = 0.6, graph_weight = 0.4
       - 如果某个chunk只出现在一个来源中，另一个分数为0
    4. 按综合分数降序排列，取 top_k
    5. 过滤 score_threshold
    """
    all_results: list[SearchResultItem] = []

    if body.collection_name:
        # 指定知识库
        coll = await db_manager.get_collection_by_name(body.collection_name)
        if coll is None:
            raise HTTPException(status_code=404, detail=f"知识库 '{body.collection_name}' 不存在")
        all_results = await _hybrid_search_collection(
            query=body.query,
            collection_id=coll["id"],
            chroma_name=coll.get("chroma_name") or coll["name"],
            use_vector=body.use_vector,
            use_graph=body.use_graph,
            top_k=body.top_k,
            score_threshold=body.score_threshold,
        )
    else:
        # 搜索所有知识库
        collections = await db_manager.list_collections()
        for coll in collections:
            try:
                chroma_name = coll.get("chroma_name") or coll["name"]
                results = await _hybrid_search_collection(
                    query=body.query,
                    collection_id=coll["id"],
                    chroma_name=chroma_name,
                    use_vector=body.use_vector,
                    use_graph=body.use_graph,
                    top_k=body.top_k,
                    score_threshold=body.score_threshold,
                )
                all_results.extend(results)
            except Exception as e:
                logger.warning("在知识库 '%s' 中混合检索失败: %s", coll["name"], e)
                continue

        # 按分数降序排列，截取 top_k
        all_results.sort(key=lambda x: x.score, reverse=True)
        all_results = all_results[: body.top_k]

    return SearchResponse(
        query=body.query,
        results=all_results,
        total=len(all_results),
    )


async def _hybrid_search_collection(
    query: str,
    collection_id: str,
    chroma_name: str,
    use_vector: bool,
    use_graph: bool,
    top_k: int,
    score_threshold: float,
) -> list[SearchResultItem]:
    """对单个知识库执行混合检索"""
    # chunk_id -> {vector_score, graph_score, content, metadata, document_id, chunk_index}
    merged: dict[str, dict] = {}

    # 1. 向量检索
    if use_vector:
        try:
            vector_results = await retriever_search(
                query=query,
                collection_name=chroma_name,
                top_k=top_k * 2,
                score_threshold=0.0,  # 不在此处过滤，融合后再过滤
            )
            for r in vector_results:
                # 用 document_id + chunk_index 构造唯一 key
                chunk_key = f"{r.document_id}_{r.chunk_index}"
                # 也记录 chunk_id（如果 metadata 中有）
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
                # 批量获取图谱 chunk 的内容
                graph_chunk_ids = [g["chunk_id"] for g in graph_results]
                chunks_data = await db_manager.get_chunks_by_ids(graph_chunk_ids)
                chunks_map = {c["id"]: c for c in chunks_data}

                for g in graph_results:
                    cid = g["chunk_id"]
                    graph_score = g["graph_score"]
                    matched_entities = g.get("matched_entities", [])
                    chunk_data = chunks_map.get(cid)

                    if cid in merged:
                        # 已在向量结果中，补充图谱分数
                        merged[cid]["graph_score"] = max(
                            merged[cid]["graph_score"], graph_score
                        )
                        merged[cid]["metadata"]["matched_entities"] = matched_entities
                    else:
                        # 仅图谱结果
                        if chunk_data:
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
                        else:
                            # chunk 已被删除，跳过
                            logger.debug("图谱检索 chunk %s 在数据库中不存在", cid)
        except Exception as e:
            logger.warning("图谱检索失败 (collection=%s): %s", collection_id, e)

    # 3. 按 chunk_key 去重（同一个 chunk 可能通过不同 id 出现）
    deduped: dict[str, dict] = {}
    for cid, info in merged.items():
        key = info["chunk_key"]
        if key not in deduped:
            deduped[key] = info
        else:
            # 合并分数取较高者
            existing = deduped[key]
            existing["vector_score"] = max(existing["vector_score"], info["vector_score"])
            existing["graph_score"] = max(existing["graph_score"], info["graph_score"])

    # 4. 计算综合分数
    results: list[SearchResultItem] = []
    for info in deduped.values():
        combined_score = round(
            _VECTOR_WEIGHT * info["vector_score"] + _GRAPH_WEIGHT * info["graph_score"],
            4,
        )
        if combined_score < score_threshold:
            continue

        # 附加文档信息
        doc_info = await _get_document_info(info["document_id"])
        meta = {**info["metadata"]}
        meta["source"] = "hybrid"
        meta["vector_score"] = info["vector_score"]
        meta["graph_score"] = info["graph_score"]
        if doc_info:
            meta["document_filename"] = doc_info.get("filename", "")
            meta["document_file_type"] = doc_info.get("file_type", "")

        results.append(
            SearchResultItem(
                content=info["content"],
                score=combined_score,
                metadata=meta,
                document_id=info["document_id"],
                chunk_index=info["chunk_index"],
            )
        )

    # 5. 按综合分数降序排列，取 top_k
    results.sort(key=lambda x: x.score, reverse=True)
    results = results[:top_k]

    return results


# ── 图谱检索 ────────────────────────────────────────────────


@router.post("/graph", response_model=SearchResponse)
async def search_graph(body: SearchQuery):
    """独立图谱检索 — 基于知识图谱的实体关系检索

    - collection_name 不传则搜索所有知识库
    - 返回按图谱相关度降序排列的 chunks 列表
    - metadata 中额外包含 source、matched_entities、graph_score
    """
    all_results: list[SearchResultItem] = []

    if body.collection_name:
        # 指定知识库
        coll = await db_manager.get_collection_by_name(body.collection_name)
        if coll is None:
            raise HTTPException(status_code=404, detail=f"知识库 '{body.collection_name}' 不存在")
        all_results = await _graph_search_collection(
            query=body.query,
            collection_id=coll["id"],
            top_k=body.top_k,
            score_threshold=body.score_threshold,
        )
    else:
        # 搜索所有知识库
        collections = await db_manager.list_collections()
        for coll in collections:
            try:
                results = await _graph_search_collection(
                    query=body.query,
                    collection_id=coll["id"],
                    top_k=body.top_k,
                    score_threshold=body.score_threshold,
                )
                all_results.extend(results)
            except Exception as e:
                logger.warning("在知识库 '%s' 中图谱检索失败: %s", coll["name"], e)
                continue

        # 按分数降序排列，截取 top_k
        all_results.sort(key=lambda x: x.score, reverse=True)
        all_results = all_results[: body.top_k]

    return SearchResponse(
        query=body.query,
        results=all_results,
        total=len(all_results),
    )


async def _graph_search_collection(
    query: str,
    collection_id: str,
    top_k: int,
    score_threshold: float,
) -> list[SearchResultItem]:
    """对单个知识库执行图谱检索"""
    graph_results = await graph_search(
        query=query,
        collection_id=collection_id,
        top_k=top_k * 2,
    )

    if not graph_results:
        return []

    # 批量获取图谱 chunk 的内容
    graph_chunk_ids = [g["chunk_id"] for g in graph_results]
    chunks_data = await db_manager.get_chunks_by_ids(graph_chunk_ids)
    chunks_map = {c["id"]: c for c in chunks_data}

    results: list[SearchResultItem] = []
    for g in graph_results:
        cid = g["chunk_id"]
        graph_score = g["graph_score"]
        matched_entities = g.get("matched_entities", [])
        chunk_data = chunks_map.get(cid)

        if not chunk_data:
            logger.debug("图谱检索 chunk %s 在数据库中不存在", cid)
            continue

        if graph_score < score_threshold:
            continue

        # 附加文档信息
        doc_info = await _get_document_info(chunk_data["document_id"])
        meta = {**chunk_data.get("metadata", {})}
        meta["source"] = "graph"
        meta["graph_score"] = graph_score
        meta["matched_entities"] = matched_entities
        if doc_info:
            meta["document_filename"] = doc_info.get("filename", "")
            meta["document_file_type"] = doc_info.get("file_type", "")

        results.append(
            SearchResultItem(
                content=chunk_data["content"],
                score=graph_score,
                metadata=meta,
                document_id=chunk_data["document_id"],
                chunk_index=chunk_data["chunk_index"],
            )
        )

    # 按分数降序排列，取 top_k
    results.sort(key=lambda x: x.score, reverse=True)
    results = results[:top_k]

    return results
