"""RAG2.0 检索引擎 — 封装 ChromaDB 查询逻辑"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from app.core.embedding import embedding_model
from app.db.database import db_manager

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """检索结果条目"""

    content: str
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)
    document_id: str = ""
    chunk_index: int = 0


async def search(
    query: str,
    collection_name: str,
    top_k: int = 5,
    score_threshold: float = 0.0,
) -> list[SearchResult]:
    """在指定知识库中检索与查询最相关的文本片段

    Args:
        query: 查询文本
        collection_name: 知识库在 ChromaDB 中的实际名称（chroma_name）
        top_k: 返回结果数量
        score_threshold: 最低相似度阈值（0~1，低于此值的结果被过滤）

    Returns:
        按相似度降序排列的检索结果列表
    """
    # 1. 编码查询
    logger.info("检索查询: %s (collection=%s, top_k=%d)", query[:50], collection_name, top_k)
    query_embeddings = embedding_model.encode_query(query)

    # 2. 获取 ChromaDB collection
    collection = db_manager.get_or_create_collection(collection_name)

    # 3. 构建查询参数（仅使用 dense 向量，ChromaDB 标准 query 接口）
    query_params: dict[str, Any] = {
        "query_embeddings": query_embeddings["dense"].tolist(),
        "n_results": top_k,
        "include": ["documents", "metadatas", "distances"],
    }

    # 4. 执行查询
    results = collection.query(**query_params)

    # 5. 解析结果
    search_results: list[SearchResult] = []

    if not results["ids"] or not results["ids"][0]:
        logger.info("未找到匹配结果")
        return search_results

    ids = results["ids"][0]
    documents = results["documents"][0] if results["documents"] else [""] * len(ids)
    metadatas = results["metadatas"][0] if results["metadatas"] else [{}] * len(ids)
    distances = results["distances"][0] if results["distances"] else [1.0] * len(ids)

    for i, doc_id in enumerate(ids):
        # ChromaDB cosine distance → similarity score (1 - distance)
        distance = distances[i]
        score = 1.0 - distance

        if score < score_threshold:
            continue

        meta = metadatas[i] if i < len(metadatas) else {}
        search_results.append(
            SearchResult(
                content=documents[i] if i < len(documents) else "",
                score=round(score, 4),
                metadata=meta,
                document_id=meta.get("document_id", doc_id),
                chunk_index=int(meta.get("chunk_index", 0)),
            )
        )

    logger.info("检索完成，返回 %d 条结果", len(search_results))
    return search_results


# ── 图谱检索 ────────────────────────────────────────────────────


async def graph_search(
    query: str,
    collection_id: str,
    top_k: int = 10,
) -> list[dict[str, Any]]:
    """基于图谱的检索

    流程：
    1. 从查询文本中提取关键词/实体（简单的文本匹配方式，不调用LLM）
    2. 在图谱节点中查找匹配的实体
    3. 获取匹配实体的邻域节点（通过边连接的节点）
    4. 收集所有相关节点关联的chunk_ids
    5. 返回相关chunks信息，带上图谱相关度分数

    图谱相关度计算：
    - 直接命中节点的chunks: score = 1.0
    - 一跳邻居节点的chunks: score = 0.7
    - 根据匹配度（实体文本与查询的重叠程度）调整分数
    """
    import re as _re
    
    # 1. 简单分词：按空格、标点分割，过滤短词
    _sep_pattern = _re.compile(r'[\s,，。.!！?？;；:：、\\/|()（）\[\]【】{}\'\"\u201c\u201d\u2018\u2019]+'  )
    tokens = [
        t.lower() for t in _sep_pattern.split(query) if len(t) >= 2
    ]
    # 也把完整 query 作为一个匹配项
    full_query = query.strip().lower()
    if full_query and len(full_query) >= 2:
        tokens.append(full_query)

    logger.info(
        "图谱检索: query=%r, collection_id=%s, tokens=%s",
        query[:50], collection_id, tokens,
    )

    if not tokens:
        return []

    # 2. 获取图谱数据
    nodes = await db_manager.get_graph_nodes(collection_id)
    edges = await db_manager.get_graph_edges(collection_id)

    if not nodes:
        logger.info("图谱检索: collection %s 无图谱节点", collection_id)
        return []

    # 构建节点 id -> node 映射
    node_map: dict[str, dict[str, Any]] = {n["id"]: n for n in nodes}

    # 3. 匹配节点：query包含entity_text，或entity_text包含query中的关键词
    matched_nodes: dict[str, dict[str, Any]] = {}  # node_id -> {node, score, matched_keyword}

    for node in nodes:
        entity_lower = node["entity_text"].lower()
        best_score = 0.0
        best_keyword = ""

        for token in tokens:
            # 完整 query 与实体匹配（双向包含）
            if token == full_query:
                if entity_lower in full_query or full_query in entity_lower:
                    overlap_ratio = len(token) / max(len(entity_lower), len(token))
                    s = 0.5 + 0.5 * overlap_ratio  # 0.5 ~ 1.0
                    if s > best_score:
                        best_score = s
                        best_keyword = token
            else:
                # 关键词与实体匹配
                if token in entity_lower or entity_lower in token:
                    overlap_ratio = min(len(token), len(entity_lower)) / max(len(token), len(entity_lower))
                    s = 0.5 + 0.5 * overlap_ratio
                    if s > best_score:
                        best_score = s
                        best_keyword = token

        if best_score > 0:
            matched_nodes[node["id"]] = {
                "node": node,
                "score": best_score,  # 基础匹配分数
                "matched_keyword": best_keyword,
            }

    if not matched_nodes:
        logger.info("图谱检索: 未找到匹配实体")
        return []

    # 4. 构建邻接表，找一跳邻居
    adjacency: dict[str, set[str]] = {n["id"]: set() for n in nodes}
    for edge in edges:
        src, tgt = edge["source_node_id"], edge["target_node_id"]
        if src in adjacency:
            adjacency[src].add(tgt)
        if tgt in adjacency:
            adjacency[tgt].add(src)

    # 5. 收集 chunks 及分数
    # chunk_id -> {graph_score, matched_entities}
    chunk_scores: dict[str, dict[str, Any]] = {}

    for node_id, match_info in matched_nodes.items():
        node = match_info["node"]
        base_score = match_info["score"]

        # 直接命中节点的 chunks: score = 1.0 * base_score
        for cid in node.get("chunk_ids", []):
            if cid not in chunk_scores or chunk_scores[cid]["graph_score"] < 1.0 * base_score:
                chunk_scores[cid] = {
                    "graph_score": round(1.0 * base_score, 4),
                    "matched_entities": [node["entity_text"]],
                }
            else:
                # 合并匹配实体
                if node["entity_text"] not in chunk_scores[cid]["matched_entities"]:
                    chunk_scores[cid]["matched_entities"].append(node["entity_text"])

        # 一跳邻居节点的 chunks: score = 0.7 * base_score
        for neighbor_id in adjacency.get(node_id, set()):
            if neighbor_id in node_map and neighbor_id not in matched_nodes:
                neighbor = node_map[neighbor_id]
                for cid in neighbor.get("chunk_ids", []):
                    neighbor_score = round(0.7 * base_score, 4)
                    if cid not in chunk_scores:
                        chunk_scores[cid] = {
                            "graph_score": neighbor_score,
                            "matched_entities": [node["entity_text"], neighbor["entity_text"]],
                        }
                    else:
                        # 已有分数取较高者
                        if neighbor_score > chunk_scores[cid]["graph_score"]:
                            chunk_scores[cid]["graph_score"] = neighbor_score
                        if neighbor["entity_text"] not in chunk_scores[cid]["matched_entities"]:
                            chunk_scores[cid]["matched_entities"].append(neighbor["entity_text"])

    # 6. 按分数降序排列，取 top_k
    sorted_chunks = sorted(chunk_scores.items(), key=lambda x: x[1]["graph_score"], reverse=True)
    sorted_chunks = sorted_chunks[:top_k]

    result = [
        {"chunk_id": cid, **info}
        for cid, info in sorted_chunks
    ]

    logger.info("图谱检索完成，返回 %d 条结果", len(result))
    return result
