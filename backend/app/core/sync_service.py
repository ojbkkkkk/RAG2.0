"""目录同步服务 — 定时轮询本地目录，自动同步文件变更到知识库"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime
from fnmatch import fnmatch
from pathlib import Path
from typing import Optional

from app.config import settings
from app.db.database import db_manager
from app.parsers import get_parser, supported_extensions

logger = logging.getLogger(__name__)


class SyncService:
    """目录同步服务，管理多个同步目录的定时轮询"""

    def __init__(self):
        self._running = False
        self._tasks: dict[str, asyncio.Task] = {}  # sync_folder_id → asyncio.Task

    async def start(self):
        """服务启动：加载所有 active 的 sync_folders，为每个创建轮询协程"""
        self._running = True
        folders = await db_manager.get_active_sync_folders()
        for folder in folders:
            self._start_polling(folder)
        logger.info("SyncService 启动，共 %d 个活跃同步目录", len(folders))

    async def stop(self):
        """服务停止：取消所有轮询协程"""
        self._running = False
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
        logger.info("SyncService 已停止")

    async def add_folder(self, sync_folder: dict):
        """新增同步目录并启动轮询"""
        if sync_folder["id"] in self._tasks:
            return
        self._start_polling(sync_folder)

    async def remove_folder(self, sync_folder_id: str):
        """移除同步目录，停止轮询"""
        task = self._tasks.pop(sync_folder_id, None)
        if task:
            task.cancel()

    async def update_folder(self, sync_folder: dict):
        """更新同步目录配置（先停再启）"""
        await self.remove_folder(sync_folder["id"])
        if sync_folder.get("active", 1):
            self._start_polling(sync_folder)

    async def trigger_sync(self, sync_folder_id: str):
        """手动触发一次同步"""
        folder = await db_manager.get_sync_folder(sync_folder_id)
        if folder:
            await self._sync_once(folder)

    def _start_polling(self, sync_folder: dict):
        """创建轮询协程"""
        task = asyncio.create_task(self._poll_loop(sync_folder))
        self._tasks[sync_folder["id"]] = task

    async def _poll_loop(self, sync_folder: dict):
        """单个目录的轮询循环"""
        folder_id = sync_folder["id"]
        interval = sync_folder.get("poll_interval", 30)
        try:
            while self._running:
                # 每次循环重新获取最新配置（可能被更新了）
                current = await db_manager.get_sync_folder(folder_id)
                if not current or not current.get("active", 1):
                    break
                await self._sync_once(current)
                await asyncio.sleep(current.get("poll_interval", interval))
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("同步目录轮询异常 [%s]: %s", folder_id, e)

    async def _sync_once(self, sync_folder: dict):
        """执行一次同步：扫描目录 vs 数据库，检测新增/修改/删除"""
        folder_path = sync_folder["folder_path"]
        collection_id = sync_folder["collection_id"]

        if not os.path.isdir(folder_path):
            logger.warning("同步目录不存在: %s", folder_path)
            return

        # 1. 扫描目录中的文件
        disk_files = self._scan_directory(folder_path, sync_folder)

        # 2. 获取数据库中该 collection 通过同步来的文档
        db_docs = await db_manager.get_documents_with_source_path(collection_id)
        db_map = {doc["source_path"]: doc for doc in db_docs}

        new_files = []
        modified_files = []
        deleted_paths = set(db_map.keys())

        for file_path, mtime in disk_files.items():
            deleted_paths.discard(file_path)
            if file_path not in db_map:
                new_files.append((file_path, mtime))
            elif abs(mtime - db_map[file_path].get("source_mtime", 0)) > 0.01:
                modified_files.append((file_path, mtime))

        # 3. 处理新增
        new_doc_ids = []
        for file_path, mtime in new_files:
            doc_id = await self._add_file(file_path, mtime, collection_id)
            if doc_id:
                new_doc_ids.append(doc_id)

        # 4. 处理修改
        modified_doc_ids = []
        for file_path, mtime in modified_files:
            doc_id = await self._update_file(file_path, mtime, db_map[file_path])
            if doc_id:
                modified_doc_ids.append(doc_id)

        # 5. 处理删除
        for source_path in deleted_paths:
            doc = db_map[source_path]
            await self._remove_file(doc)

        # 6. 更新 last_synced_at
        await db_manager.update_sync_folder(
            sync_folder["id"], last_synced_at=datetime.now().isoformat()
        )

        # 7. 可选：自动向量化/深入学习
        affected_ids = new_doc_ids + modified_doc_ids
        if affected_ids:
            await self._auto_process(sync_folder, collection_id, affected_ids)

        if new_files or modified_files or deleted_paths:
            logger.info(
                "同步完成 [%s]: 新增%d, 修改%d, 删除%d",
                folder_path,
                len(new_files),
                len(modified_files),
                len(deleted_paths),
            )

    def _scan_directory(self, folder_path: str, sync_folder: dict) -> dict[str, float]:
        """扫描目录，返回 {绝对路径: mtime} 字典"""
        result = {}
        supported_exts = set(supported_extensions())

        # 文件过滤
        file_filter = sync_folder.get("file_filter", "")
        if file_filter:
            allowed_exts = set(
                "." + ext.strip().lstrip(".")
                for ext in file_filter.split(",")
                if ext.strip()
            )
        else:
            allowed_exts = supported_exts

        # 忽略模式
        ignore_patterns = sync_folder.get("ignore_patterns", [])
        if isinstance(ignore_patterns, str):
            try:
                ignore_patterns = json.loads(ignore_patterns)
            except (json.JSONDecodeError, TypeError):
                ignore_patterns = []

        for root, dirs, files in os.walk(folder_path):
            # 过滤忽略目录
            dirs[:] = [
                d for d in dirs if not any(fnmatch(d, p) for p in ignore_patterns)
            ]

            for fname in files:
                # 检查忽略模式
                if any(fnmatch(fname, p) for p in ignore_patterns):
                    continue

                ext = os.path.splitext(fname)[1].lower()
                if ext not in allowed_exts:
                    continue

                full_path = os.path.join(root, fname)
                try:
                    stat = os.stat(full_path)
                    result[full_path] = stat.st_mtime
                except OSError:
                    continue

        return result

    async def _add_file(
        self, file_path: str, mtime: float, collection_id: str
    ) -> Optional[str]:
        """新增文件：解析 → 存 MD → 创建 document"""
        try:
            filename = os.path.basename(file_path)
            ext = os.path.splitext(filename)[1].lower()

            # 解析文件
            parser = get_parser(Path(file_path))
            if parser is None:
                logger.warning("无可用解析器，跳过: %s", file_path)
                return None

            parsed_doc = await parser.parse(Path(file_path))

            # 检测解析器静默错误
            if "error" in parsed_doc.metadata and not parsed_doc.content.strip():
                error_msg = parsed_doc.metadata.get("error", "未知解析错误")
                logger.error("解析文件失败（静默错误）: %s — %s", filename, error_msg)
                return None

            # 构建 Markdown（与 _process_single_file 逻辑一致）
            md_content = self._sections_to_markdown(parsed_doc, filename)
            if not md_content.strip():
                logger.warning("解析为空，跳过: %s", file_path)
                return None

            # 创建 document 记录（先创建再拿 doc_id）
            file_size = os.path.getsize(file_path)
            file_type = parsed_doc.file_type or ext.lstrip(".")
            doc = await db_manager.create_document(
                collection_id=collection_id,
                filename=filename,
                file_type=file_type,
                file_size=file_size,
            )
            doc_id = doc["id"]

            # 保存 MD（用 doc_id 命名）
            md_filename = f"{doc_id}.md"
            md_path = settings.MARKDOWN_DIR / md_filename
            os.makedirs(settings.MARKDOWN_DIR, exist_ok=True)
            md_path.write_text(md_content, encoding="utf-8")

            md_path_relative = f"markdown/{md_filename}"

            # 更新 document 的 md_path、source_path、source_mtime、status
            await db_manager.update_document(
                doc_id, md_path=md_path_relative, status="ready"
            )
            # source_path / source_mtime 需要直接 SQL 更新（update_document 已扩展支持）
            await db_manager.update_document_source(doc_id, file_path, mtime)

            logger.info("同步新增: %s → %s", filename, md_filename)
            return doc_id
        except Exception as e:
            logger.error("同步新增失败 [%s]: %s", file_path, e)
            return None

    async def _update_file(
        self, file_path: str, mtime: float, doc: dict
    ) -> Optional[str]:
        """修改文件：重新解析 → 覆盖 MD → 重置状态 → 清理旧数据"""
        try:
            doc_id = doc["id"]
            collection_id = doc.get("collection_id", "")
            filename = os.path.basename(file_path)

            # 重新解析
            parser = get_parser(Path(file_path))
            if parser is None:
                logger.warning("无可用解析器，跳过更新: %s", file_path)
                return None

            parsed_doc = await parser.parse(Path(file_path))
            if "error" in parsed_doc.metadata and not parsed_doc.content.strip():
                error_msg = parsed_doc.metadata.get("error", "未知解析错误")
                logger.error("重新解析失败（静默错误）: %s — %s", filename, error_msg)
                return None

            # 覆盖 MD
            md_content = self._sections_to_markdown(parsed_doc, filename)
            if not md_content.strip():
                logger.warning("重新解析为空，跳过: %s", file_path)
                return None

            md_path_rel = doc.get("md_path", "")
            if md_path_rel:
                md_path = settings.DATA_DIR / md_path_rel
            else:
                md_filename = f"{doc_id}.md"
                md_path = settings.MARKDOWN_DIR / md_filename
                md_path_rel = f"markdown/{md_filename}"

            md_path.write_text(md_content, encoding="utf-8")

            # 重置状态
            await db_manager.update_document(
                doc_id, vectorized=0, graph_extracted=0, md_path=md_path_rel
            )
            await db_manager.update_document_source(doc_id, file_path, mtime)

            # 删除旧的 chunks（SQLite + ChromaDB）
            try:
                # 从 ChromaDB 删除该文档的向量
                coll = await db_manager.get_collection(collection_id)
                if coll:
                    chroma_name = coll.get("chroma_name") or coll["name"]
                    try:
                        chroma_col = db_manager.get_or_create_collection(chroma_name)
                        chroma_col.delete(where={"document_id": doc_id})
                    except Exception:
                        pass
                # 从 SQLite 删除 chunks
                await db_manager.delete_chunks_by_document(doc_id)
            except Exception as chunk_err:
                logger.warning("清理旧 chunks 失败 [%s]: %s", doc_id, chunk_err)

            # 删除旧的图谱数据
            try:
                await db_manager.remove_document_from_graph_nodes(doc_id)
            except Exception as graph_err:
                logger.warning("清理旧图谱数据失败 [%s]: %s", doc_id, graph_err)

            logger.info("同步更新: %s", filename)
            return doc_id
        except Exception as e:
            logger.error("同步更新失败 [%s]: %s", file_path, e)
            return None

    async def _remove_file(self, doc: dict):
        """删除文件：删 document + MD + chunks + 图谱"""
        try:
            doc_id = doc["id"]
            collection_id = doc.get("collection_id", "")

            # 删除 MD 文件
            md_path_rel = doc.get("md_path", "")
            if md_path_rel:
                md_path = settings.DATA_DIR / md_path_rel
                if md_path.exists():
                    md_path.unlink()

            # 从 ChromaDB 删除该文档的向量
            try:
                coll = await db_manager.get_collection(collection_id)
                if coll:
                    chroma_name = coll.get("chroma_name") or coll["name"]
                    try:
                        chroma_col = db_manager.get_or_create_collection(chroma_name)
                        chroma_col.delete(where={"document_id": doc_id})
                    except Exception:
                        pass
            except Exception:
                pass

            # 从图谱中移除该文档引用
            try:
                await db_manager.remove_document_from_graph_nodes(doc_id)
            except Exception:
                pass

            # 删除 document（级联删除 chunks）
            await db_manager.delete_document(doc_id)

            logger.info("同步删除: %s", doc.get("filename", doc_id))
        except Exception as e:
            logger.error("同步删除失败 [%s]: %s", doc.get("id", "?"), e)

    async def _auto_process(
        self, sync_folder: dict, collection_id: str, doc_ids: list[str]
    ):
        """根据配置自动触发向量化/深入学习"""
        auto_vectorize = sync_folder.get("auto_vectorize", 0)
        auto_extract = sync_folder.get("auto_extract", 0)

        if auto_vectorize:
            try:
                from app.api.vectorize import _run_vectorize_task

                task_id = uuid.uuid4().hex
                coll = await db_manager.get_collection(collection_id)
                if coll:
                    chroma_name = coll.get("chroma_name") or coll["name"]
                    chunk_size = coll.get("chunk_size") or settings.CHUNK_SIZE
                    chunk_overlap = coll.get("chunk_overlap") or settings.CHUNK_OVERLAP

                    # 获取文档完整记录
                    documents = []
                    for doc_id in doc_ids:
                        doc = await db_manager.get_document(doc_id)
                        if doc:
                            documents.append(doc)

                    if documents:
                        await db_manager.create_vectorize_task(
                            task_id=task_id,
                            collection_id=collection_id,
                            document_ids=doc_ids,
                        )
                        asyncio.create_task(
                            _run_vectorize_task(
                                task_id=task_id,
                                collection_id=collection_id,
                                chroma_name=chroma_name,
                                documents=documents,
                                chunk_size=chunk_size,
                                chunk_overlap=chunk_overlap,
                            )
                        )
                        logger.info("自动向量化已触发: %d 个文档", len(doc_ids))
            except Exception as e:
                logger.error("自动向量化失败: %s", e)

        if auto_extract:
            try:
                from app.api.graph import _run_extraction_v2

                task_id = uuid.uuid4().hex
                await db_manager.create_extraction_task(collection_id, doc_ids)
                # create_extraction_task 会生成自己的 task_id，我们需要获取它
                # 改用直接调用的方式
                task = await db_manager.create_extraction_task(
                    collection_id, doc_ids
                )
                asyncio.create_task(
                    _run_extraction_v2(task["id"], collection_id, doc_ids)
                )
                logger.info("自动深入学习已触发: %d 个文档", len(doc_ids))
            except Exception as e:
                logger.error("自动深入学习失败: %s", e)

    def _sections_to_markdown(self, parsed_doc, filename: str) -> str:
        """将解析后的 ParsedDocument 拼接为 Markdown 格式

        与 documents.py 中 _process_single_file 的逻辑保持一致。
        """
        md_lines: list[str] = []

        if parsed_doc.sections:
            for section in parsed_doc.sections:
                # section 可能是 dict 或有 title/content 属性的对象
                if isinstance(section, dict):
                    title = section.get("title", "").strip()
                    content = section.get("content", "").strip()
                else:
                    title = getattr(section, "title", "") or ""
                    content = getattr(section, "content", "") or ""
                    if isinstance(title, str):
                        title = title.strip()
                    if isinstance(content, str):
                        content = content.strip()

                if title:
                    md_lines.append(f"## {title}\n")
                if content:
                    md_lines.append(content)
                    md_lines.append("")  # 段落间空行
        else:
            # 没有分节，直接写全文
            md_lines.append(parsed_doc.content)

        return "\n".join(md_lines).strip()


# 全局单例
sync_service = SyncService()

