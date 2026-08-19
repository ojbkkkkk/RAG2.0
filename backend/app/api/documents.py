"""RAG2.0 文档管理 API"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import List

from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile

from app.config import settings
from app.db.database import db_manager
from app.models.schemas import (
    BatchDeleteGraphRequest,
    BatchDeleteGraphResponse,
    BatchDeleteRequest,
    BatchDeleteResponse,
    BatchDeleteVectorsRequest,
    BatchDeleteVectorsResponse,
    ChunkResponse,
    DocumentResponse,
    UploadTaskResponse,
)
from app.parsers import get_parser, supported_extensions

logger = logging.getLogger(__name__)

router = APIRouter(tags=["documents"])

# ── 目录初始化 ───────────────────────────────────────────────

UPLOAD_DIR = settings.DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MARKDOWN_DIR = settings.MARKDOWN_DIR
MARKDOWN_DIR.mkdir(parents=True, exist_ok=True)


# ── 工具函数：解析文档并保存为 Markdown ──────────────────────


async def _process_single_file(
    file_path: Path,
    original_filename: str,
    collection_id: str,
) -> DocumentResponse:
    """处理单个文件：解析 → 保存为 Markdown → 创建文档记录

    Args:
        file_path: 临时文件路径（已保存到磁盘）
        original_filename: 原始文件名
        collection_id: 所属知识库 ID

    Returns:
        DocumentResponse 文档记录
    """
    suffix = Path(original_filename).suffix.lower()

    # 1. 检查文件格式
    if suffix not in supported_extensions():
        raise ValueError(
            f"不支持的文件格式: {suffix}，支持的格式: {supported_extensions()}"
        )

    # 2. 获取 parser
    parser = get_parser(file_path)
    if parser is None:
        raise ValueError(f"无法解析文件: {original_filename}")

    # 3. 解析文件
    try:
        parsed_doc = await parser.parse(file_path)
    except Exception as e:
        logger.error("解析文件失败: %s — %s", original_filename, e)
        raise ValueError(f"文件解析失败: {e}")

    # 检测解析器静默错误
    if "error" in parsed_doc.metadata and not parsed_doc.content.strip():
        error_msg = parsed_doc.metadata.get("error", "未知解析错误")
        logger.error("解析文件失败（静默错误）: %s — %s", original_filename, error_msg)
        raise ValueError(error_msg)

    # 4. 生成 doc_id 并构建 Markdown 内容
    doc_id = uuid.uuid4().hex

    md_lines: list[str] = []
    if parsed_doc.sections:
        for section in parsed_doc.sections:
            title = section.get("title", "").strip()
            content = section.get("content", "").strip()
            if title:
                md_lines.append(f"## {title}\n")
            if content:
                md_lines.append(content)
                md_lines.append("")  # 段落间空行
    else:
        # 没有分节，直接写全文
        md_lines.append(parsed_doc.content)

    md_content = "\n".join(md_lines).strip()

    # 5. 保存 Markdown 文件
    md_filename = f"{doc_id}.md"
    md_file_path = MARKDOWN_DIR / md_filename
    try:
        md_file_path.write_text(md_content, encoding="utf-8")
    except Exception as e:
        logger.error("保存 Markdown 文件失败: %s — %s", original_filename, e)
        raise ValueError(f"保存 Markdown 失败: {e}")

    md_path_relative = f"markdown/{md_filename}"

    # 6. 获取文件大小
    file_size = file_path.stat().st_size if file_path.exists() else 0
    file_type = parsed_doc.file_type or suffix.lstrip(".")

    # 7. 创建 SQLite 文档记录（status=ready, vectorized=0, graph_extracted=0）
    doc = await db_manager.create_document(
        collection_id=collection_id,
        filename=original_filename,
        file_type=file_type,
        file_size=file_size,
        md_path=md_path_relative,
    )

    # 8. 更新文档状态为 ready（chunk_count=0，分块由向量化任务负责）
    await db_manager.update_document_status(doc["id"], "ready", 0)

    # 9. 刷新文档信息（含最新状态）
    doc = await db_manager.get_document(doc["id"])
    logger.info("文档解析完成: %s → %s", original_filename, md_path_relative)
    return DocumentResponse(**doc)


# ── 后台上传任务 ─────────────────────────────────────────────


async def _run_upload_task(
    task_id: str,
    collection_id: str,
    temp_file_paths: list[str],
    filenames: list[str],
) -> None:
    """后台任务：依次处理每个文件，支持取消和进度更新"""
    created_doc_ids: list[str] = []
    total = len(temp_file_paths)

    try:
        await db_manager.update_upload_task(
            task_id,
            status="running",
            total_files=total,
            current_step="开始处理文件",
        )

        for idx, (tmp_path_str, filename) in enumerate(zip(temp_file_paths, filenames)):
            # 检查任务是否被取消
            task = await db_manager.get_upload_task(task_id)
            if task and task.get("status") == "cancelled":
                logger.info("上传任务已取消: %s", task_id)
                return

            tmp_path = Path(tmp_path_str)
            current_step = f"正在处理 {filename} ({idx + 1}/{total})"
            await db_manager.update_upload_task(
                task_id,
                current_step=current_step,
                processed_files=idx,
                progress=round(idx / total, 3),
            )

            try:
                doc_resp = await _process_single_file(tmp_path, filename, collection_id)
                created_doc_ids.append(doc_resp.id)
                logger.info("上传任务[%s] 处理成功: %s", task_id, filename)
            except Exception as e:
                logger.error("上传任务[%s] 处理文件失败: %s — %s", task_id, filename, e)
                # 单文件失败不中断整体任务，记录错误继续
                await db_manager.update_upload_task(
                    task_id,
                    current_step=f"处理 {filename} 失败: {e}",
                    created_doc_ids=created_doc_ids,
                )
            finally:
                # 清理临时文件
                if tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except Exception:
                        pass

        # 全部完成
        await db_manager.update_upload_task(
            task_id,
            status="completed",
            progress=1.0,
            current_step="全部文件处理完成",
            processed_files=total,
            created_doc_ids=created_doc_ids,
        )
        logger.info(
            "上传任务完成: %s, 成功 %d/%d 个文件", task_id, len(created_doc_ids), total
        )

    except Exception as e:
        logger.error("上传任务失败: %s — %s", task_id, e)
        # 清理所有临时文件
        for tmp_path_str in temp_file_paths:
            tmp_path = Path(tmp_path_str)
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except Exception:
                    pass
        await db_manager.update_upload_task(
            task_id,
            status="failed",
            error_message=str(e),
            created_doc_ids=created_doc_ids,
        )


# ── 上传文档（后台任务模式）──────────────────────────────────


@router.post(
    "/api/collections/{collection_id}/upload",
    status_code=202,
)
async def start_upload(
    collection_id: str,
    files: List[UploadFile],
    background_tasks: BackgroundTasks,
):
    """发起文件上传任务（异步后台处理）

    返回 task_id，客户端可轮询 GET /api/upload-tasks 查看进度。
    流程：保存临时文件 → 后台解析 → 存为 Markdown → 创建文档记录（status=ready）
    """
    # 1. 验证 collection 存在
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    if not files:
        raise HTTPException(status_code=400, detail="未提供任何文件")

    # 2. 预先将文件内容保存到临时目录（BackgroundTasks 中 UploadFile 已关闭）
    temp_file_paths: list[str] = []
    filenames: list[str] = []
    task_id = uuid.uuid4().hex

    try:
        for file in files:
            suffix = Path(file.filename).suffix.lower() if file.filename else ""
            temp_filename = f"upload_{task_id}_{uuid.uuid4().hex}{suffix}"
            temp_path = UPLOAD_DIR / temp_filename
            content = await file.read()
            temp_path.write_bytes(content)
            temp_file_paths.append(str(temp_path))
            filenames.append(file.filename or "unknown")
    except Exception as e:
        # 清理已写入的临时文件
        for p in temp_file_paths:
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"文件保存失败: {e}")

    # 3. 创建 upload_task 记录
    await db_manager.create_upload_task(
        task_id=task_id,
        collection_id=collection_id,
        filenames=filenames,
    )
    await db_manager.update_upload_task(
        task_id,
        total_files=len(files),
    )

    # 4. 启动后台任务
    background_tasks.add_task(
        _run_upload_task,
        task_id,
        collection_id,
        temp_file_paths,
        filenames,
    )

    logger.info(
        "上传任务已创建: task_id=%s, collection=%s, files=%d",
        task_id,
        collection_id,
        len(files),
    )
    return {"task_id": task_id, "total_files": len(files), "filenames": filenames}


# ── 查询上传任务列表 ──────────────────────────────────────────


@router.get(
    "/api/upload-tasks",
    response_model=list[UploadTaskResponse],
)
async def get_upload_tasks():
    """返回所有活跃的上传任务（status=pending/running）"""
    tasks = await db_manager.get_active_upload_tasks()
    return [UploadTaskResponse(**t) for t in tasks]


# ── 取消上传任务 ──────────────────────────────────────────────


@router.post("/api/upload-tasks/{task_id}/cancel", status_code=200)
async def cancel_upload_task(task_id: str):
    """取消上传任务，并回滚已创建的文档和 Markdown 文件"""
    task = await db_manager.get_upload_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="上传任务不存在")

    if task["status"] not in ("pending", "running"):
        raise HTTPException(
            status_code=400,
            detail=f"任务状态为 {task['status']}，无法取消",
        )

    # 1. 标记为 cancelled（后台任务下次检查时会停止）
    await db_manager.update_upload_task(task_id, status="cancelled")

    # 2. 回滚：删除已创建的文档记录和对应 Markdown 文件
    created_doc_ids: list[str] = task.get("created_doc_ids") or []
    rollback_errors: list[str] = []

    for doc_id in created_doc_ids:
        try:
            doc = await db_manager.get_document(doc_id)
            if doc and doc.get("md_path"):
                md_file = settings.DATA_DIR / doc["md_path"]
                if md_file.exists():
                    md_file.unlink()
            await db_manager.delete_document(doc_id)
            logger.info("回滚删除文档: %s", doc_id)
        except Exception as e:
            rollback_errors.append(f"删除文档 {doc_id} 失败: {e}")
            logger.error("回滚删除文档失败: %s — %s", doc_id, e)

    result = {
        "task_id": task_id,
        "cancelled": True,
        "rolled_back_docs": len(created_doc_ids) - len(rollback_errors),
    }
    if rollback_errors:
        result["rollback_errors"] = rollback_errors

    return result


# ── 列出知识库内所有文档 ────────────────────────────────────


@router.get(
    "/api/collections/{collection_id}/documents",
    response_model=list[DocumentResponse],
)
async def list_documents(collection_id: str):
    """列出知识库内所有文档"""
    coll = await db_manager.get_collection(collection_id)
    if coll is None:
        raise HTTPException(status_code=404, detail="知识库不存在")

    documents = await db_manager.list_documents(collection_id)
    return [DocumentResponse(**d) for d in documents]


# ── 批量删除向量 ────────────────────────────────────────────


@router.post("/api/documents/delete-vectors", response_model=BatchDeleteVectorsResponse)
async def delete_vectors(body: BatchDeleteVectorsRequest):
    """批量删除文档向量数据（ChromaDB + SQLite chunks），重置 vectorized 状态"""
    deleted_count = 0

    for document_id in body.document_ids:
        doc = await db_manager.get_document(document_id)
        if doc is None:
            logger.warning("文档不存在，跳过删除向量: %s", document_id)
            continue

        # 1. 从 ChromaDB 删除该文档的向量
        coll = await db_manager.get_collection(doc["collection_id"])
        if coll:
            chroma_name = coll.get("chroma_name") or coll["name"]
            try:
                collection = db_manager.get_or_create_collection(chroma_name)
                collection.delete(where={"document_id": document_id})
            except Exception as e:
                logger.warning("从 ChromaDB 删除向量失败: %s — %s", document_id, e)

        # 2. 从 SQLite 删除关联 chunks
        try:
            await db_manager.delete_chunks_by_document(document_id)
        except Exception as e:
            logger.warning("从 SQLite 删除 chunks 失败: %s — %s", document_id, e)

        # 3. 重置文档的 vectorized 和 chunk_count
        try:
            await db_manager.reset_document_vectorized([document_id])
        except Exception as e:
            logger.warning("重置文档 vectorized 状态失败: %s — %s", document_id, e)

        deleted_count += 1
        logger.info("文档向量已删除: %s", document_id)

    return BatchDeleteVectorsResponse(success=True, deleted_count=deleted_count)


# ── 批量删除图谱数据 ────────────────────────────────────────────


@router.post("/api/documents/delete-graph", response_model=BatchDeleteGraphResponse)
async def delete_graph(body: BatchDeleteGraphRequest):
    """批量删除文档图谱数据（仅删除该文档独有的节点），重置 graph_extracted 状态"""
    total_deleted_nodes = 0
    total_deleted_edges = 0
    valid_ids: list[str] = []

    for document_id in body.document_ids:
        doc = await db_manager.get_document(document_id)
        if doc is None:
            logger.warning("文档不存在，跳过删除图谱: %s", document_id)
            continue

        # 从图谱节点中移除该文档引用（删除独有节点和关联边）
        try:
            deleted_nodes, deleted_edges = await db_manager.remove_document_from_graph_nodes(document_id)
            total_deleted_nodes += deleted_nodes
            total_deleted_edges += deleted_edges
            logger.info(
                "文档图谱数据已删除: %s (节点=%d, 边=%d)",
                document_id, deleted_nodes, deleted_edges,
            )
            valid_ids.append(document_id)
        except Exception as e:
            logger.error("删除文档图谱数据失败: %s — %s", document_id, e)

    # 批量重置文档的 graph_extracted
    if valid_ids:
        try:
            await db_manager.reset_document_graph_extracted(valid_ids)
        except Exception as e:
            logger.error("批量重置 graph_extracted 失败: %s", e)

    return BatchDeleteGraphResponse(
        success=True,
        deleted_nodes=total_deleted_nodes,
        deleted_edges=total_deleted_edges,
    )


# ── 获取文档详情 ────────────────────────────────────────────


@router.get("/api/documents/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str):
    """获取文档详情"""
    doc = await db_manager.get_document(document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")
    return DocumentResponse(**doc)


# ── 获取文档的所有分块 ──────────────────────────────────────


@router.get("/api/documents/{document_id}/chunks", response_model=list[ChunkResponse])
async def get_document_chunks(document_id: str):
    """获取文档的所有分块"""
    doc = await db_manager.get_document(document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    chunks = await db_manager.get_chunks_by_document(document_id)
    return [
        ChunkResponse(
            id=c["id"],
            document_id=c["document_id"],
            collection_id=c["collection_id"],
            content=c["content"],
            chunk_index=c["chunk_index"],
            metadata=c["metadata_json"] if isinstance(c["metadata_json"], dict) else {},
            created_at=c["created_at"],
        )
        for c in chunks
    ]


# ── 批量删除文档 ──────────────────────────────────────────


@router.delete("/api/documents/batch", response_model=BatchDeleteResponse)
async def batch_delete_documents(body: BatchDeleteRequest):
    """批量删除文档"""
    deleted = 0
    failed = 0
    errors: list[str] = []

    for document_id in body.document_ids:
        try:
            doc = await db_manager.get_document(document_id)
            if doc is None:
                failed += 1
                errors.append(f"文档 {document_id} 不存在")
                continue

            # 删除 Markdown 文件
            if doc.get("md_path"):
                md_file = settings.DATA_DIR / doc["md_path"]
                if md_file.exists():
                    try:
                        md_file.unlink()
                    except Exception as e:
                        logger.warning("删除 Markdown 文件失败: %s", e)

            # 从 ChromaDB 中删除该文档的所有向量
            coll = await db_manager.get_collection(doc["collection_id"])
            if coll:
                chroma_name = coll.get("chroma_name") or coll["name"]
                try:
                    collection = db_manager.get_or_create_collection(chroma_name)
                    collection.delete(where={"document_id": document_id})
                except Exception as e:
                    logger.warning("从 ChromaDB 删除文档向量失败: %s", e)

            # 从 SQLite 中删除文档及关联 chunks
            await db_manager.delete_document(document_id)
            logger.info("删除文档: %s (%s)", doc["filename"], document_id)
            deleted += 1
        except Exception as e:
            failed += 1
            errors.append(f"删除文档 {document_id} 失败: {e}")
            logger.error("批量删除文档 %s 失败: %s", document_id, e)

    return BatchDeleteResponse(deleted=deleted, failed=failed, errors=errors)


# ── 删除文档 ────────────────────────────────────────────────


@router.delete("/api/documents/{document_id}", status_code=204)
async def delete_document(document_id: str):
    """删除文档（同时删除 Markdown 文件、ChromaDB 向量和 SQLite 记录）"""
    doc = await db_manager.get_document(document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="文档不存在")

    # 删除 Markdown 文件
    if doc.get("md_path"):
        md_file = settings.DATA_DIR / doc["md_path"]
        if md_file.exists():
            try:
                md_file.unlink()
            except Exception as e:
                logger.warning("删除 Markdown 文件失败: %s", e)

    # 从 ChromaDB 中删除该文档的所有向量
    coll = await db_manager.get_collection(doc["collection_id"])
    if coll:
        chroma_name = coll.get("chroma_name") or coll["name"]
        try:
            collection = db_manager.get_or_create_collection(chroma_name)
            collection.delete(where={"document_id": document_id})
        except Exception as e:
            logger.warning("从 ChromaDB 删除文档向量失败: %s", e)

    # 从 SQLite 中删除文档及关联 chunks
    await db_manager.delete_document(document_id)
    logger.info("删除文档: %s (%s)", doc["filename"], document_id)
