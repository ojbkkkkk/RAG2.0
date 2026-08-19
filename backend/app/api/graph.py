"""RAG2.0 知识图谱 API"""

from __future__ import annotations

import logging
import os

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response

from app.config import settings
from app.db.database import db_manager
from app.models.schemas import (
    ExtractRequestV2,
    ExtractionTaskResponse,
    GraphEdgeCreate,
    GraphEdgeResponse,
    GraphNodeCreate,
    GraphNodeResponse,
    GraphNodeUpdate,
    GraphStatsResponse,
    KnowledgeGraphResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/knowledge-graph", tags=["knowledge-graph"])


# ── 辅助：MD 内容分段 ────────────────────────────────────────────────────────


def _split_md_for_extraction(content: str, max_size: int = 2000) -> list:
    """将 Markdown 内容按段落切分，合并小段落直到接近 max_size。

    规则：
    - 按 \\n\\n 切分段落
    - 小段落不立即输出，合并直到超过 max_size
    - 单个超长段落不切分，完整保留
    """
    paragraphs = content.split("\n\n")
    segments = []
    current = ""
    for para in paragraphs:
        if len(current) + len(para) + 2 > max_size and current:
            segments.append(current.strip())
            current = para
        else:
            current = current + "\n\n" + para if current else para
    if current.strip():
        segments.append(current.strip())
    return segments


# ── 辅助：后台提取任务（v2：带进度更新和取消检测）──────────────────────────


async def _run_extraction_v2(task_id: str, collection_id: str, document_ids: list[str]):
    """后台执行实体关系提取（带进度更新和取消检测）— 直接从 document 的 .md 文件读取内容"""
    from app.core.graph_extractor import LLMExtractor

    try:
        # 更新状态为running
        await db_manager.update_extraction_task(task_id, status="running", current_step="准备中...")

        # 读取LLM配置
        db_settings = await db_manager.get_all_settings()
        base_url = (db_settings or {}).get("llm_base_url") or settings.LLM_BASE_URL
        api_key = (db_settings or {}).get("llm_api_key") or settings.LLM_API_KEY
        model = (db_settings or {}).get("llm_model_name") or settings.LLM_MODEL

        # 图谱提取精度配置
        max_gleanings = int((db_settings or {}).get("graph_max_gleanings", "1"))
        dedup_enabled = (db_settings or {}).get("graph_dedup_enabled", "true").lower() in ("true", "1")
        confidence_filter = (db_settings or {}).get("graph_confidence_filter", "true").lower() in ("true", "1")
        confidence_threshold = float((db_settings or {}).get("graph_confidence_threshold", "0.6"))

        # 确定待处理的 document_ids
        if document_ids:
            target_doc_ids = list(document_ids)
        else:
            docs = await db_manager.list_documents(collection_id)
            # 知识库级提取时自动跳过已提取的文档，避免重复
            target_doc_ids = [d["id"] for d in docs if not d.get("graph_extracted")]

        if not target_doc_ids:
            await db_manager.update_extraction_task(task_id, status="completed", current_step="所有文档均已提取，无需重复处理")
            return

        # 从每个 document 的 .md 文件读取内容，按段落分割为伪 chunks
        segments: list[dict] = []  # 每个元素：{"id": doc_id, "content": text}
        for doc_id in target_doc_ids:
            doc = await db_manager.get_document(doc_id)
            if not doc:
                logger.warning("Document %s not found, skipping", doc_id)
                continue
            md_path_rel = doc.get("md_path")
            if not md_path_rel:
                logger.warning("Document %s has no md_path, skipping", doc_id)
                continue
            # 支持绝对路径和相对路径（只取文件名再拼接 MARKDOWN_DIR）
            md_filename = os.path.basename(md_path_rel)
            md_path = os.path.join(str(settings.MARKDOWN_DIR), md_filename)
            if not os.path.exists(md_path):
                logger.warning("MD file not found: %s, skipping doc %s", md_path, doc_id)
                continue
            with open(md_path, "r", encoding="utf-8") as f:
                content = f.read()
            doc_segments = _split_md_for_extraction(content, max_size=2000)
            for seg_text in doc_segments:
                segments.append({"id": doc_id, "content": seg_text})

        if not segments:
            await db_manager.update_extraction_task(task_id, status="completed", current_step="无可处理的文档内容")
            return

        total = len(segments)
        await db_manager.update_extraction_task(task_id, total_chunks=total, current_step=f"共 {total} 个内容段待处理")

        created_node_ids: list[str] = []
        created_edge_ids: list[str] = []

        # 逐批处理
        batch_size = settings.GRAPH_EXTRACTION_BATCH_SIZE
        async with LLMExtractor(
            base_url, api_key, model,
            settings.LLM_TEMPERATURE, settings.LLM_MAX_TOKENS,
            max_gleanings=max_gleanings,
            dedup_enabled=dedup_enabled,
            confidence_filter=confidence_filter,
            confidence_threshold=confidence_threshold,
        ) as extractor:
            for i in range(0, total, batch_size):
                # 检查是否被取消
                task = await db_manager.get_extraction_task(task_id)
                if task and task["status"] == "cancelled":
                    logger.info("Task %s cancelled, stopping extraction", task_id)
                    return

                batch = segments[i:i + batch_size]
                batch_end = min(i + batch_size, total)
                await db_manager.update_extraction_task(
                    task_id,
                    current_step=f"正在提取 {i + 1}-{batch_end}/{total}...",
                    processed_chunks=i,
                    progress=i / total,
                )

                # 提取当前 batch（传入伪 chunks 结构）
                result = await extractor.extract_from_chunks(batch, batch_size=len(batch))

                # 存储实体，关联来源 doc_id（作为 chunk_ids 代替）
                batch_doc_ids = [c["id"] for c in batch if c.get("id")]
                entities = result.get("entities", [])
                for entity in entities:
                    if not entity.get("chunk_ids"):
                        entity["chunk_ids"] = batch_doc_ids
                relations = result.get("relations", [])
                for rel in relations:
                    if not rel.get("evidence_chunks"):
                        rel["evidence_chunks"] = batch_doc_ids

                node_map: dict[str, dict] = {}
                for entity in entities:
                    node = await db_manager.create_graph_node(
                        collection_id=collection_id,
                        entity_text=entity["text"],
                        entity_type=entity.get("type", "Concept"),
                        chunk_ids=entity.get("chunk_ids", []),
                    )
                    node_map[entity["text"]] = node
                    if node["id"] not in created_node_ids:
                        created_node_ids.append(node["id"])

                for rel in relations:
                    head_node = node_map.get(rel["head"])
                    tail_node = node_map.get(rel["tail"])
                    if head_node and tail_node:
                        edge = await db_manager.create_graph_edge(
                            collection_id=collection_id,
                            source_node_id=head_node["id"],
                            target_node_id=tail_node["id"],
                            relation_type=rel["relation"],
                            evidence_chunks=rel.get("evidence_chunks", []),
                            confidence=rel.get("confidence", 1.0),
                        )
                        if edge["id"] not in created_edge_ids:
                            created_edge_ids.append(edge["id"])

                # 更新已创建记录（用于回滚）
                await db_manager.update_extraction_task(
                    task_id,
                    created_nodes=created_node_ids,
                    created_edges=created_edge_ids,
                )

        # 提取完成：更新每个 document 的 graph_extracted 标志
        for doc_id in target_doc_ids:
            try:
                await db_manager.update_document(doc_id, graph_extracted=1)
            except Exception as upd_err:
                logger.warning("Failed to update graph_extracted for doc %s: %s", doc_id, upd_err)

        # 完成
        await db_manager.update_extraction_task(
            task_id,
            status="completed",
            progress=1.0,
            processed_chunks=total,
            current_step="提取完成",
        )
        logger.info("Extraction task %s completed: %d nodes, %d edges", task_id, len(created_node_ids), len(created_edge_ids))

    except Exception as e:
        logger.error("Extraction task %s failed: %s", task_id, str(e))
        await db_manager.update_extraction_task(task_id, status="failed", error_message=str(e))


# ── 触发实体关系提取 ──────────────────────────────────────


@router.post("/extract", response_model=ExtractionTaskResponse)
async def extract_entities(body: ExtractRequestV2, background_tasks: BackgroundTasks):
    """触发实体关系提取（返回任务信息用于追踪进度）"""
    coll = await db_manager.get_collection(body.collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    # 创建任务记录
    task = await db_manager.create_extraction_task(body.collection_id, body.document_ids)

    # 后台执行
    background_tasks.add_task(_run_extraction_v2, task["id"], body.collection_id, body.document_ids)

    return ExtractionTaskResponse(**task)


# ── 提取任务管理 ─────────────────────────────────────────


@router.get("/tasks", response_model=list[ExtractionTaskResponse])
async def list_extraction_tasks():
    """获取所有活跃提取任务"""
    tasks = await db_manager.get_active_extraction_tasks()
    return [ExtractionTaskResponse(**t) for t in tasks]


@router.get("/tasks/{task_id}", response_model=ExtractionTaskResponse)
async def get_extraction_task(task_id: str):
    """获取单个任务进度"""
    task = await db_manager.get_extraction_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return ExtractionTaskResponse(**task)


@router.post("/tasks/{task_id}/cancel")
async def cancel_extraction_task(task_id: str):
    """取消提取任务并回滚"""
    task = await db_manager.get_extraction_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task["status"] not in ("pending", "running"):
        raise HTTPException(status_code=400, detail="只能取消进行中的任务")

    # 标记为cancelled（后台任务会检测到并停止）
    await db_manager.cancel_extraction_task(task_id)

    # 回滚：删除本次创建的edges和nodes，并重置 graph_extracted
    doc_ids_to_reset = task.get("document_ids", [])
    for edge_id in task["created_edges"]:
        await db_manager.delete_graph_edge(edge_id)
    for node_id in task["created_nodes"]:
        await db_manager.delete_graph_node(node_id)
    for doc_id in doc_ids_to_reset:
        try:
            await db_manager.update_document(doc_id, graph_extracted=0)
        except Exception as upd_err:
            logger.warning("Failed to reset graph_extracted for doc %s: %s", doc_id, upd_err)

    return {"status": "cancelled", "message": "任务已取消，数据已回滚"}


@router.get("/{collection_id}/extraction-status")
async def get_extraction_status(collection_id: str):
    """获取知识库下文档的实体提取状态摘要"""
    docs = await db_manager.list_documents(collection_id)
    total = len(docs)
    extracted = sum(1 for d in docs if d.get("graph_extracted"))
    return {
        "collection_id": collection_id,
        "total_documents": total,
        "extracted_documents": extracted,
        "unextracted_documents": total - extracted,
    }


# ── 获取节点详情 ──────────────────────────────────────────


@router.get("/nodes/{node_id}/detail")
async def get_node_detail(node_id: str):
    """获取节点详情，包含关联 chunk 内容和相关边信息"""
    # 1. 查询节点
    node = await db_manager.get_graph_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="节点不存在")

    # 2. 根据 chunk_ids 获取关联 chunk 内容
    chunk_ids = node.get("chunk_ids", [])
    chunks = await db_manager.get_chunks_by_ids(chunk_ids) if chunk_ids else []

    # 3. 为每个 chunk 查询对应的 document filename
    source_chunks = []
    for chunk in chunks:
        doc = await db_manager.get_document(chunk["document_id"])
        source_chunks.append({
            "chunk_id": chunk["id"],
            "content": chunk["content"],
            "document_id": chunk["document_id"],
            "document_name": doc["filename"] if doc else "未知文档",
            "chunk_index": chunk["chunk_index"],
        })

    # 4. 查询与该节点相关的所有边
    edges = await db_manager.get_graph_edges_by_node_id(node_id)

    # 5. 为每条边附带源/目标节点的 entity_text，并标记方向
    related_edges = []
    for edge in edges:
        source_node = await db_manager.get_graph_node(edge["source_node_id"])
        target_node = await db_manager.get_graph_node(edge["target_node_id"])
        direction = "outgoing" if edge["source_node_id"] == node_id else "incoming"
        related_edges.append({
            "id": edge["id"],
            "relation_type": edge["relation_type"],
            "source_node_id": edge["source_node_id"],
            "target_node_id": edge["target_node_id"],
            "source_text": source_node["entity_text"] if source_node else "",
            "target_text": target_node["entity_text"] if target_node else "",
            "confidence": edge["confidence"],
            "direction": direction,
        })

    return {
        "node": {
            "id": node["id"],
            "entity_text": node["entity_text"],
            "entity_type": node["entity_type"],
            "chunk_ids": node["chunk_ids"],
            "collection_id": node["collection_id"],
            "created_at": node["created_at"],
            "updated_at": node["updated_at"],
        },
        "source_chunks": source_chunks,
        "related_edges": related_edges,
    }


# ── 获取整合图谱 ──────────────────────────────────────────


@router.get("/all")
async def get_all_knowledge_graphs():
    """获取所有知识库的整合知识图谱"""
    nodes = await db_manager.get_all_graph_nodes()
    edges = await db_manager.get_all_graph_edges()
    return {
        "collection_id": "all",
        "nodes": [GraphNodeResponse(**n) for n in nodes],
        "edges": [GraphEdgeResponse(**e) for e in edges],
    }


# ── 获取完整图谱 ──────────────────────────────────────────


@router.get("/{collection_id}", response_model=KnowledgeGraphResponse)
async def get_knowledge_graph(
    collection_id: str,
    document_ids: Optional[list[str]] = Query(None),
):
    """获取知识库的完整知识图谱，可选按文档筛选"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    if document_ids:
        nodes = await db_manager.get_graph_nodes_by_document_ids(collection_id, document_ids)
        node_ids = [n["id"] for n in nodes]
        edges = await db_manager.get_graph_edges_by_node_ids(node_ids)
    else:
        nodes = await db_manager.get_graph_nodes(collection_id)
        edges = await db_manager.get_graph_edges(collection_id)

    return KnowledgeGraphResponse(
        collection_id=collection_id,
        nodes=[GraphNodeResponse(**n) for n in nodes],
        edges=[GraphEdgeResponse(**e) for e in edges],
    )


# ── 图谱节点 CRUD ─────────────────────────────────────────


@router.post("/{collection_id}/nodes", response_model=GraphNodeResponse, status_code=201)
async def create_graph_node(collection_id: str, body: GraphNodeCreate):
    """手动添加图谱节点"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    node = await db_manager.create_graph_node(
        collection_id=collection_id,
        entity_text=body.entity_text,
        entity_type=body.entity_type,
        chunk_ids=body.chunk_ids,
    )
    return GraphNodeResponse(**node)


@router.put("/{collection_id}/nodes/{node_id}", response_model=GraphNodeResponse)
async def update_graph_node(collection_id: str, node_id: str, body: GraphNodeUpdate):
    """编辑图谱节点"""
    # 验证collection存在
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    # 验证节点存在且属于该collection
    node = await db_manager.get_graph_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="节点不存在")
    if node["collection_id"] != collection_id:
        raise HTTPException(status_code=400, detail="节点不属于该知识库")

    updated = await db_manager.update_graph_node(
        node_id=node_id,
        entity_text=body.entity_text,
        entity_type=body.entity_type,
        chunk_ids=body.chunk_ids,
    )
    return GraphNodeResponse(**updated)


@router.delete("/{collection_id}/nodes/{node_id}", status_code=204)
async def delete_graph_node(collection_id: str, node_id: str):
    """删除图谱节点（级联删除关联边）"""
    # 验证collection存在
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    # 验证节点存在且属于该collection
    node = await db_manager.get_graph_node(node_id)
    if node is None:
        raise HTTPException(status_code=404, detail="节点不存在")
    if node["collection_id"] != collection_id:
        raise HTTPException(status_code=400, detail="节点不属于该知识库")

    await db_manager.delete_graph_node(node_id)
    logger.info("删除图谱节点: %s (collection=%s)", node_id, collection_id)
    return Response(status_code=204)


# ── 图谱边 CRUD ───────────────────────────────────────────


@router.post("/{collection_id}/edges", response_model=GraphEdgeResponse, status_code=201)
async def create_graph_edge(collection_id: str, body: GraphEdgeCreate):
    """手动添加图谱边"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    # 验证源节点和目标节点存在
    source_node = await db_manager.get_graph_node(body.source_node_id)
    if source_node is None:
        raise HTTPException(status_code=400, detail="源节点不存在")
    target_node = await db_manager.get_graph_node(body.target_node_id)
    if target_node is None:
        raise HTTPException(status_code=400, detail="目标节点不存在")

    edge = await db_manager.create_graph_edge(
        collection_id=collection_id,
        source_node_id=body.source_node_id,
        target_node_id=body.target_node_id,
        relation_type=body.relation_type,
        evidence_chunks=body.evidence_chunks,
        confidence=body.confidence,
    )
    return GraphEdgeResponse(**edge)


@router.delete("/{collection_id}/edges/{edge_id}", status_code=204)
async def delete_graph_edge(collection_id: str, edge_id: str):
    """删除图谱边"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    await db_manager.delete_graph_edge(edge_id)
    logger.info("删除图谱边: %s (collection=%s)", edge_id, collection_id)
    return Response(status_code=204)


# ── 图谱统计 ──────────────────────────────────────────────


@router.get("/{collection_id}/stats", response_model=GraphStatsResponse)
async def get_graph_stats(collection_id: str):
    """获取图谱统计信息"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    stats = await db_manager.get_graph_stats(collection_id)
    return GraphStatsResponse(**stats)
