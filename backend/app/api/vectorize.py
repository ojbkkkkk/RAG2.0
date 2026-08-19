"""RAG2.0 向量化 API — MD → 分块 → 嵌入 → ChromaDB"""

from __future__ import annotations

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.config import settings
from app.core.chunking import chunk_text
from app.core.embedding import embedding_model
from app.db.database import db_manager
from app.models.schemas import VectorizeRequest, VectorizeTaskResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["vectorize"])


# ── 辅助：将 task dict 转成响应模型 ──────────────────────────────


def _task_to_response(task: dict) -> VectorizeTaskResponse:
    return VectorizeTaskResponse(
        id=task["id"],
        collection_id=task["collection_id"],
        document_ids=task.get("document_ids", []),
        status=task["status"],
        progress=task.get("progress", 0.0),
        current_step=task.get("current_step", ""),
        total_chunks=task.get("total_chunks", 0),
        processed_chunks=task.get("processed_chunks", 0),
        created_chunk_ids=task.get("created_chunk_ids", []),
        error_message=task.get("error_message", ""),
        created_at=task["created_at"],
        updated_at=task["updated_at"],
    )


# ── 端点 1：启动向量化任务 ─────────────────────────────────────


@router.post(
    "/collections/{collection_id}/vectorize",
    response_model=VectorizeTaskResponse,
    status_code=202,
)
async def start_vectorize(
    collection_id: str,
    request: VectorizeRequest,
    background_tasks: BackgroundTasks,
):
    """触发向量化：MD → 分块 → 嵌入 → 存入 ChromaDB

    仅处理 status=ready 且 md_path 非空的文档。
    """
    # 1. 验证 collection 存在，获取配置
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    chroma_name: str = coll.get("chroma_name") or coll["name"]
    chunk_size: int = coll.get("chunk_size") or settings.CHUNK_SIZE
    chunk_overlap: int = coll.get("chunk_overlap") or settings.CHUNK_OVERLAP

    # 2. 验证所有 document_ids 归属该 collection 且 status=ready
    doc_ids = list(request.document_ids)
    valid_docs: list[dict] = []
    for doc_id in doc_ids:
        doc = await db_manager.get_document(doc_id)
        if doc is None:
            raise HTTPException(status_code=404, detail=f"文档不存在: {doc_id}")
        if doc["collection_id"] != collection_id:
            raise HTTPException(
                status_code=400,
                detail=f"文档 {doc_id} 不属于该知识库",
            )
        if doc["status"] != "ready":
            raise HTTPException(
                status_code=400,
                detail=f"文档 {doc_id} 状态为 {doc['status']}，需为 ready",
            )
        if not doc.get("md_path"):
            raise HTTPException(
                status_code=400,
                detail=f"文档 {doc_id} 缺少 md_path，请先完成文件解析",
            )
        valid_docs.append(doc)

    # 3. 创建 vectorize_task 记录
    task_id = uuid.uuid4().hex
    task = await db_manager.create_vectorize_task(
        task_id=task_id,
        collection_id=collection_id,
        document_ids=doc_ids,
    )

    # 4. 启动后台任务
    background_tasks.add_task(
        _run_vectorize_task,
        task_id=task_id,
        collection_id=collection_id,
        chroma_name=chroma_name,
        documents=valid_docs,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    logger.info("向量化任务已创建: task_id=%s, 文档数=%d", task_id, len(doc_ids))
    return _task_to_response(task)


# ── 端点 2：查询活跃任务列表 ──────────────────────────────────


@router.get("/vectorize-tasks", response_model=list[VectorizeTaskResponse])
async def get_vectorize_tasks():
    """返回所有 pending/running 状态的向量化任务"""
    tasks = await db_manager.get_active_vectorize_tasks()
    return [_task_to_response(t) for t in tasks]


# ── 端点 3：查询单个任务 ──────────────────────────────────────


@router.get("/vectorize-tasks/{task_id}", response_model=VectorizeTaskResponse)
async def get_vectorize_task(task_id: str):
    """获取单个向量化任务详情"""
    task = await db_manager.get_vectorize_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    return _task_to_response(task)


# ── 端点 4：取消任务 ──────────────────────────────────────────


@router.post("/vectorize-tasks/{task_id}/cancel", response_model=VectorizeTaskResponse)
async def cancel_vectorize_task(task_id: str):
    """取消向量化任务，并回滚已写入的数据"""
    task = await db_manager.get_vectorize_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")

    if task["status"] not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"任务状态为 {task['status']}，无法取消",
        )

    # 标记为 cancelled（后台任务检测到后会停止）
    await db_manager.update_vectorize_task(task_id, status="cancelled")

    # 回滚：删除已创建的 chunks
    created_chunk_ids: list[str] = task.get("created_chunk_ids", [])
    if created_chunk_ids:
        await _rollback_chunks(
            chunk_ids=created_chunk_ids,
            collection_id=task["collection_id"],
            document_ids=task.get("document_ids", []),
        )

    task = await db_manager.get_vectorize_task(task_id)
    logger.info("向量化任务已取消: task_id=%s", task_id)
    return _task_to_response(task)


# ── 后台任务实现 ───────────────────────────────────────────────


async def _run_vectorize_task(
    task_id: str,
    collection_id: str,
    chroma_name: str,
    documents: list[dict],
    chunk_size: int,
    chunk_overlap: int,
) -> None:
    """后台执行向量化流程"""
    created_chunk_ids: list[str] = []

    try:
        await db_manager.update_vectorize_task(
            task_id,
            status="running",
            current_step="初始化",
            progress=0.0,
        )

        total_docs = len(documents)

        for doc_idx, doc in enumerate(documents):
            # 检查是否已被取消
            latest = await db_manager.get_vectorize_task(task_id)
            if latest and latest["status"] == "cancelled":
                logger.info("向量化任务已被取消，中断执行: task_id=%s", task_id)
                return

            doc_id = doc["id"]
            filename = doc["filename"]
            md_path_str = doc.get("md_path", "")

            await db_manager.update_vectorize_task(
                task_id,
                current_step=f"处理文档 {doc_idx + 1}/{total_docs}: {filename}",
                progress=round(doc_idx / total_docs, 3),
                created_chunk_ids=created_chunk_ids,
            )

            # 读取 md 文件内容
            md_path = settings.DATA_DIR / md_path_str
            if not md_path.exists():
                logger.warning("MD 文件不存在，跳过: %s", md_path_str)
                continue

            try:
                content = md_path.read_text(encoding="utf-8")
            except Exception as e:
                logger.error("读取 MD 文件失败: %s — %s", md_path_str, e)
                continue

            if not content.strip():
                logger.warning("MD 文件内容为空，跳过: %s", md_path_str)
                continue

            # 分块
            base_metadata = {
                "filename": filename,
                "file_type": doc.get("file_type", ""),
                "document_id": doc_id,
                "collection_id": collection_id,
            }
            chunks = chunk_text(
                text=content,
                metadata=base_metadata,
                strategy="markdown",
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
            )

            if not chunks:
                logger.warning("文档分块结果为空，跳过: %s", doc_id)
                continue

            # 嵌入
            texts = [c.content for c in chunks]

            # embedding 是 CPU/GPU 密集型，用 asyncio.to_thread 避免阻塞事件循环
            embeddings_result = await asyncio.to_thread(embedding_model.encode_texts, texts)
            dense_vectors = embeddings_result["dense"]

            # 获取 ChromaDB collection
            chroma_collection = db_manager.get_or_create_collection(chroma_name)

            # 构建批量写入数据
            chroma_ids: list[str] = []
            chroma_embeddings: list[list[float]] = []
            chroma_documents: list[str] = []
            chroma_metadatas: list[dict] = []

            for i, chunk in enumerate(chunks):
                chunk_id = uuid.uuid4().hex
                chunk_meta = {
                    **chunk.metadata,
                    "document_id": doc_id,
                    "collection_id": collection_id,
                    "chunk_index": chunk.chunk_index,
                }

                # 写入 SQLite chunks 表
                await db_manager.create_chunk(
                    document_id=doc_id,
                    collection_id=collection_id,
                    content=chunk.content,
                    chunk_index=chunk.chunk_index,
                    metadata=chunk_meta,
                )

                chroma_ids.append(chunk_id)
                chroma_embeddings.append(dense_vectors[i].tolist())
                chroma_documents.append(chunk.content)
                chroma_metadatas.append(chunk_meta)
                created_chunk_ids.append(chunk_id)

            # 批量写入 ChromaDB
            chroma_collection.add(
                ids=chroma_ids,
                embeddings=chroma_embeddings,
                documents=chroma_documents,
                metadatas=chroma_metadatas,
            )

            # 更新文档状态：已向量化
            await db_manager.update_document_status(doc_id, "ready", len(chunks))
            # 单独更新 vectorized 标志
            await db_manager._db.execute(
                "UPDATE documents SET vectorized = 1, chunk_count = ? WHERE id = ?",
                (len(chunks), doc_id),
            )
            await db_manager._db.commit()

            logger.info(
                "文档向量化完成: %s, 分块数: %d", filename, len(chunks)
            )

        # 全部完成
        await db_manager.update_vectorize_task(
            task_id,
            status="completed",
            progress=1.0,
            current_step="向量化完成",
            total_chunks=len(created_chunk_ids),
            processed_chunks=len(created_chunk_ids),
            created_chunk_ids=created_chunk_ids,
        )
        logger.info(
            "向量化任务全部完成: task_id=%s, 总 chunk 数=%d",
            task_id,
            len(created_chunk_ids),
        )

    except Exception as e:
        logger.exception("向量化任务执行失败: task_id=%s — %s", task_id, e)
        # 回滚已写入数据
        if created_chunk_ids:
            try:
                latest = await db_manager.get_vectorize_task(task_id)
                coll_id = latest["collection_id"] if latest else collection_id
                doc_ids = latest.get("document_ids", []) if latest else []
                await _rollback_chunks(
                    chunk_ids=created_chunk_ids,
                    collection_id=coll_id,
                    document_ids=doc_ids,
                )
            except Exception as rollback_err:
                logger.error("回滚失败: %s", rollback_err)

        await db_manager.update_vectorize_task(
            task_id,
            status="failed",
            error_message=str(e),
            created_chunk_ids=created_chunk_ids,
        )


# ── 回滚辅助 ──────────────────────────────────────────────────


async def _rollback_chunks(
    chunk_ids: list[str],
    collection_id: str,
    document_ids: list[str],
) -> None:
    """回滚已写入的 chunk 数据（SQLite + ChromaDB）"""
    if not chunk_ids:
        return

    logger.info("回滚向量化数据，chunk 数: %d", len(chunk_ids))

    # 从 ChromaDB 删除（按 chunk_id 列表删除）
    try:
        coll = await db_manager.get_collection(collection_id)
        if coll:
            chroma_name = coll.get("chroma_name") or coll["name"]
            chroma_collection = db_manager.get_or_create_collection(chroma_name)
            chroma_collection.delete(ids=chunk_ids)
            logger.info("ChromaDB 回滚完成，删除 %d 条向量", len(chunk_ids))
    except Exception as e:
        logger.error("ChromaDB 回滚失败: %s", e)

    # 从 SQLite 删除 chunks（分批，避免 IN 参数超限）
    try:
        batch_size = 900
        for i in range(0, len(chunk_ids), batch_size):
            batch = chunk_ids[i : i + batch_size]
            placeholders = ",".join("?" * len(batch))
            await db_manager._db.execute(
                f"DELETE FROM chunks WHERE id IN ({placeholders})",
                batch,
            )
        await db_manager._db.commit()
        logger.info("SQLite chunks 回滚完成")
    except Exception as e:
        logger.error("SQLite chunks 回滚失败: %s", e)

    # 将相关文档的 vectorized 重置为 0
    if document_ids:
        try:
            for doc_id in document_ids:
                await db_manager._db.execute(
                    "UPDATE documents SET vectorized = 0, chunk_count = 0 WHERE id = ?",
                    (doc_id,),
                )
            await db_manager._db.commit()
            logger.info("文档 vectorized 标志已重置")
        except Exception as e:
            logger.error("重置文档 vectorized 标志失败: %s", e)
