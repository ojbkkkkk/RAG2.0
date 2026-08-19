"""RAG2.0 数据库管理 — SQLite（元数据） + ChromaDB（向量）"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import aiosqlite
import chromadb

from app.config import settings


# ── SQL 建表语句 ──────────────────────────────────────────────

_SQL_CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS collections (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    chroma_name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL,
    document_count INTEGER NOT NULL DEFAULT 0,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    chunk_size      INTEGER NOT NULL DEFAULT 512,
    chunk_overlap   INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY,
    collection_id   TEXT NOT NULL REFERENCES collections(id),
    filename        TEXT NOT NULL,
    file_type       TEXT NOT NULL,
    file_size       INTEGER NOT NULL DEFAULT 0,
    md_path         TEXT,
    vectorized      INTEGER NOT NULL DEFAULT 0,
    graph_extracted INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'processing',
    created_at      TEXT NOT NULL,
    chunk_count     INTEGER NOT NULL DEFAULT 0,
    source_path     TEXT DEFAULT '',
    source_mtime    REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS chunks (
    id            TEXT PRIMARY KEY,
    document_id   TEXT NOT NULL REFERENCES documents(id),
    collection_id TEXT NOT NULL REFERENCES collections(id),
    content       TEXT NOT NULL,
    chunk_index   INTEGER NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_nodes (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id),
    entity_text   TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    chunk_ids     TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE(collection_id, entity_text, entity_type)
);

CREATE TABLE IF NOT EXISTS graph_edges (
    id              TEXT PRIMARY KEY,
    collection_id   TEXT NOT NULL REFERENCES collections(id),
    source_node_id  TEXT NOT NULL REFERENCES graph_nodes(id),
    target_node_id  TEXT NOT NULL REFERENCES graph_nodes(id),
    relation_type   TEXT NOT NULL,
    confidence      REAL DEFAULT 1.0,
    evidence_chunks TEXT NOT NULL DEFAULT '[]',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(collection_id, source_node_id, target_node_id, relation_type)
);

CREATE TABLE IF NOT EXISTS settings (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS extraction_tasks (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id),
    document_ids  TEXT NOT NULL DEFAULT '[]',
    status        TEXT NOT NULL DEFAULT 'pending',
    progress      REAL NOT NULL DEFAULT 0.0,
    current_step  TEXT NOT NULL DEFAULT '',
    total_chunks  INTEGER NOT NULL DEFAULT 0,
    processed_chunks INTEGER NOT NULL DEFAULT 0,
    created_nodes TEXT NOT NULL DEFAULT '[]',
    created_edges TEXT NOT NULL DEFAULT '[]',
    error_message TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upload_tasks (
    id              TEXT PRIMARY KEY,
    collection_id   TEXT NOT NULL REFERENCES collections(id),
    filenames       TEXT DEFAULT '[]',
    status          TEXT DEFAULT 'pending',
    progress        REAL DEFAULT 0.0,
    current_step    TEXT DEFAULT '',
    processed_files INTEGER DEFAULT 0,
    total_files     INTEGER DEFAULT 0,
    created_doc_ids TEXT DEFAULT '[]',
    error_message   TEXT DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vectorize_tasks (
    id               TEXT PRIMARY KEY,
    collection_id    TEXT NOT NULL REFERENCES collections(id),
    document_ids     TEXT DEFAULT '[]',
    status           TEXT DEFAULT 'pending',
    progress         REAL DEFAULT 0.0,
    current_step     TEXT DEFAULT '',
    total_chunks     INTEGER DEFAULT 0,
    processed_chunks INTEGER DEFAULT 0,
    created_chunk_ids TEXT DEFAULT '[]',
    error_message    TEXT DEFAULT '',
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_folders (
    id              TEXT PRIMARY KEY,
    collection_id   TEXT NOT NULL,
    folder_path     TEXT NOT NULL,
    poll_interval   INTEGER DEFAULT 30,
    auto_vectorize  INTEGER DEFAULT 0,
    auto_extract    INTEGER DEFAULT 0,
    file_filter     TEXT DEFAULT '',
    ignore_patterns TEXT DEFAULT '[]',
    active          INTEGER DEFAULT 1,
    last_synced_at  TEXT DEFAULT '',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES collections(id),
    UNIQUE(collection_id, folder_path)
);

CREATE TABLE IF NOT EXISTS integration_services (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    agent_type      TEXT NOT NULL,
    enabled         INTEGER NOT NULL DEFAULT 1,
    collections     TEXT NOT NULL DEFAULT '[]',
    retrieval_mode  TEXT NOT NULL DEFAULT 'vector',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);"""


class DatabaseManager:
    """统一管理 SQLite 元数据与 ChromaDB 向量存储"""

    def __init__(self) -> None:
        self._db: aiosqlite.Connection | None = None
        self._chroma_client: chromadb.PersistentClient | None = None

    # ── 生命周期 ─────────────────────────────────────────────

    async def init(self) -> None:
        """初始化数据库连接、建表、初始化 ChromaDB"""
        # 确保目录存在
        settings.DATA_DIR.mkdir(parents=True, exist_ok=True)
        settings.CHROMA_DIR.mkdir(parents=True, exist_ok=True)

        # SQLite
        self._db = await aiosqlite.connect(str(settings.SQLITE_PATH))
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_SQL_CREATE_TABLES)
        await self._db.commit()

        # 兼容已有数据库：确保新字段存在
        await self._migrate_add_chunk_fields()
        await self._migrate_add_chroma_name()
        await self._migrate_add_document_fields()
        await self._migrate_add_sync_fields()
        await self._ensure_default_settings()

        # ChromaDB — 持久化模式
        self._chroma_client = chromadb.PersistentClient(path=str(settings.CHROMA_DIR))

    async def close(self) -> None:
        """关闭数据库连接"""
        if self._db:
            await self._db.close()
            self._db = None
        # ChromaDB PersistentClient 无需显式关闭
        self._chroma_client = None

    # ── Settings CRUD ────────────────────────────────────────────

    async def _ensure_default_settings(self) -> None:
        """确保预置配置项存在"""
        defaults = {
            "system_name": "矩阵-知识库管理系统",
            "system_version": "v1.03",
            "llm_base_url": "",
            "llm_api_key": "",
            "llm_model_name": "",
            "logo_path": "",
        }
        for key, value in defaults.items():
            cursor = await self._db.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            )
            row = await cursor.fetchone()
            if not row:
                await self._db.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?)",
                    (key, value),
                )
        await self._db.commit()

    async def get_setting(self, key: str) -> str | None:
        """获取单个配置项"""
        cursor = await self._db.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        )
        row = await cursor.fetchone()
        return row["value"] if row else None

    async def set_setting(self, key: str, value: str) -> None:
        """设置单个配置项"""
        now = datetime.utcnow().isoformat()
        await self._db.execute(
            "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now),
        )
        await self._db.commit()

    async def get_all_settings(self) -> dict[str, str]:
        """获取所有配置项"""
        cursor = await self._db.execute("SELECT key, value FROM settings")
        rows = await cursor.fetchall()
        return {row["key"]: row["value"] for row in rows}

    # ── ChromaDB ─────────────────────────────────────────────

    @property
    def chroma(self) -> chromadb.PersistentClient:
        if self._chroma_client is None:
            raise RuntimeError("ChromaDB 未初始化，请先调用 init()")
        return self._chroma_client

    def get_or_create_collection(self, name: str) -> chromadb.Collection:
        """获取或创建 ChromaDB collection"""
        return self.chroma.get_or_create_collection(
            name=name,
            metadata={"hnsw:space": "cosine"},
        )

    # ── Collections CRUD ─────────────────────────────────────

    async def _migrate_add_chunk_fields(self) -> None:
        """为已有数据库添加 chunk_size / chunk_overlap 字段（兼容旧数据）"""
        try:
            await self._db.execute(
                "ALTER TABLE collections ADD COLUMN chunk_size INTEGER NOT NULL DEFAULT 512"
            )
            await self._db.commit()
        except aiosqlite.OperationalError:
            pass  # 字段已存在，无需添加

        try:
            await self._db.execute(
                "ALTER TABLE collections ADD COLUMN chunk_overlap INTEGER NOT NULL DEFAULT 50"
            )
            await self._db.commit()
        except aiosqlite.OperationalError:
            pass  # 字段已存在，无需添加

    @staticmethod
    def _sanitize_for_chroma(name: str) -> str:
        """将名称清洗为 ChromaDB 合法的 collection name

        ChromaDB 要求：3-63 字符，仅允许 [a-z][A-Z][0-9]_- 且首尾为字母数字。
        """
        # 替换非法字符为下划线
        sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", name)
        # 确保首尾是字母数字
        sanitized = re.sub(r"^[^a-zA-Z0-9]+", "", sanitized)
        sanitized = re.sub(r"[^a-zA-Z0-9]+$", "", sanitized)
        # 长度不够时补齐
        if len(sanitized) < 3:
            sanitized = (sanitized + "_coll")[:3]
        # 截断到 63 字符
        sanitized = sanitized[:63]
        return sanitized

    @staticmethod
    def _generate_chroma_name() -> str:
        """生成全局唯一的 ChromaDB collection name"""
        return f"coll_{uuid.uuid4().hex[:16]}"

    async def _migrate_add_document_fields(self) -> None:
        """为已有数据库添加 md_path / vectorized / graph_extracted 字段（兼容旧数据）"""
        for col_def in [
            ("md_path", "TEXT"),
            ("vectorized", "INTEGER NOT NULL DEFAULT 0"),
            ("graph_extracted", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            col_name, col_type = col_def
            try:
                await self._db.execute(
                    f"ALTER TABLE documents ADD COLUMN {col_name} {col_type}"
                )
                await self._db.commit()
            except aiosqlite.OperationalError:
                pass  # 字段已存在，无需添加

    async def _migrate_add_sync_fields(self) -> None:
        """为已有数据库添加 source_path / source_mtime 字段（兼容旧数据）"""
        for col_name, col_type in [
            ("source_path", "TEXT DEFAULT ''"),
            ("source_mtime", "REAL DEFAULT 0"),
        ]:
            try:
                await self._db.execute(
                    f"ALTER TABLE documents ADD COLUMN {col_name} {col_type}"
                )
                await self._db.commit()
            except aiosqlite.OperationalError:
                pass  # 字段已存在，无需添加

    async def _migrate_add_chroma_name(self) -> None:
        """为已有数据库添加 chroma_name 字段（兼容旧数据）"""
        try:
            await self._db.execute(
                "ALTER TABLE collections ADD COLUMN chroma_name TEXT"
            )
            await self._db.commit()
        except aiosqlite.OperationalError:
            pass  # 字段已存在，无需添加

        # 对已有但 chroma_name 为 NULL 的记录，根据 name 生成 chroma_name
        cursor = await self._db.execute(
            "SELECT id, name FROM collections WHERE chroma_name IS NULL"
        )
        rows = await cursor.fetchall()
        for row in rows:
            row_dict = dict(row)
            # 尝试清洗原 name；如果清洗后合法就用它，否则生成新名称
            sanitized = self._sanitize_for_chroma(row_dict["name"])
            # 检查清洗后的名称是否已存在于 chroma_name 列
            cursor2 = await self._db.execute(
                "SELECT id FROM collections WHERE chroma_name = ? AND id != ?",
                (sanitized, row_dict["id"]),
            )
            if await cursor2.fetchone():
                # 清洗后的名称冲突，用 UUID 生成
                chroma_name = self._generate_chroma_name()
            else:
                chroma_name = sanitized
            await self._db.execute(
                "UPDATE collections SET chroma_name = ? WHERE id = ?",
                (chroma_name, row_dict["id"]),
            )
        if rows:
            await self._db.commit()

    async def create_collection(
        self, name: str, description: str = "", chunk_size: int = 512, chunk_overlap: int = 50
    ) -> dict[str, Any]:
        collection_id = uuid.uuid4().hex
        chroma_name = self._generate_chroma_name()
        now = datetime.utcnow().isoformat()
        await self._db.execute(
            "INSERT INTO collections (id, name, chroma_name, description, created_at, chunk_size, chunk_overlap) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (collection_id, name, chroma_name, description, now, chunk_size, chunk_overlap),
        )
        await self._db.commit()
        # 同时在 ChromaDB 创建对应 collection（使用 chroma_name）
        self.get_or_create_collection(chroma_name)
        return {
            "id": collection_id,
            "name": name,
            "chroma_name": chroma_name,
            "description": description,
            "created_at": now,
            "document_count": 0,
            "chunk_count": 0,
            "chunk_size": chunk_size,
            "chunk_overlap": chunk_overlap,
        }

    async def get_collection(self, collection_id: str) -> dict[str, Any] | None:
        cursor = await self._db.execute(
            "SELECT * FROM collections WHERE id = ?", (collection_id,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_collection_by_name(self, name: str) -> dict[str, Any] | None:
        cursor = await self._db.execute(
            "SELECT * FROM collections WHERE name = ?", (name,)
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_collections(self) -> list[dict[str, Any]]:
        cursor = await self._db.execute("SELECT * FROM collections ORDER BY created_at DESC")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_chroma_name(self, collection_id: str) -> str | None:
        """根据 collection_id 获取对应的 chroma_name"""
        cursor = await self._db.execute(
            "SELECT chroma_name FROM collections WHERE id = ?", (collection_id,)
        )
        row = await cursor.fetchone()
        return row["chroma_name"] if row else None

    async def get_chroma_name_by_display_name(self, name: str) -> str | None:
        """根据用户显示名称（中文名等）获取对应的 chroma_name"""
        cursor = await self._db.execute(
            "SELECT chroma_name FROM collections WHERE name = ?", (name,)
        )
        row = await cursor.fetchone()
        return row["chroma_name"] if row else None

    async def delete_collection(self, name: str) -> None:
        """删除 collection（SQLite + ChromaDB），name 为用户显示名称"""
        coll = await self.get_collection_by_name(name)
        if coll is None:
            return
        chroma_name = coll.get("chroma_name") or coll["name"]
        # 先删关联 graph_edges、graph_nodes、chunks、documents
        await self._db.execute("DELETE FROM graph_edges WHERE collection_id = ?", (coll["id"],))
        await self._db.execute("DELETE FROM graph_nodes WHERE collection_id = ?", (coll["id"],))
        await self._db.execute("DELETE FROM chunks WHERE collection_id = ?", (coll["id"],))
        await self._db.execute("DELETE FROM documents WHERE collection_id = ?", (coll["id"],))
        await self._db.execute("DELETE FROM collections WHERE id = ?", (coll["id"],))
        await self._db.commit()
        # ChromaDB（使用 chroma_name）
        try:
            self.chroma.delete_collection(name=chroma_name)
        except ValueError:
            pass

    # ── Documents CRUD ───────────────────────────────────────

    async def create_document(
        self,
        collection_id: str,
        filename: str,
        file_type: str,
        file_size: int = 0,
        md_path: str | None = None,
    ) -> dict[str, Any]:
        doc_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()
        await self._db.execute(
            "INSERT INTO documents (id, collection_id, filename, file_type, file_size, md_path, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'processing', ?)",
            (doc_id, collection_id, filename, file_type, file_size, md_path, now),
        )
        # 更新 collection 的 document_count
        await self._db.execute(
            "UPDATE collections SET document_count = document_count + 1 WHERE id = ?",
            (collection_id,),
        )
        await self._db.commit()
        return {
            "id": doc_id,
            "collection_id": collection_id,
            "filename": filename,
            "file_type": file_type,
            "file_size": file_size,
            "md_path": md_path,
            "vectorized": 0,
            "graph_extracted": 0,
            "status": "processing",
            "created_at": now,
            "chunk_count": 0,
        }

    async def update_document_status(
        self, doc_id: str, status: str, chunk_count: int = 0
    ) -> None:
        await self._db.execute(
            "UPDATE documents SET status = ?, chunk_count = ? WHERE id = ?",
            (status, chunk_count, doc_id),
        )
        # 同步更新 collection 的 chunk_count
        await self._db.execute(
            "UPDATE collections SET chunk_count = ("
            "  SELECT COALESCE(SUM(chunk_count), 0) FROM documents WHERE collection_id = "
            "  (SELECT collection_id FROM documents WHERE id = ?)"
            ") WHERE id = (SELECT collection_id FROM documents WHERE id = ?)",
            (doc_id, doc_id),
        )
        await self._db.commit()

    async def get_document(self, doc_id: str) -> dict[str, Any] | None:
        cursor = await self._db.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def list_documents(self, collection_id: str) -> list[dict[str, Any]]:
        cursor = await self._db.execute(
            "SELECT * FROM documents WHERE collection_id = ? ORDER BY created_at DESC",
            (collection_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def update_document(self, doc_id: str, **kwargs) -> None:
        """通用更新文档字段（支持 graph_extracted, vectorized, status, md_path, chunk_count 等）"""
        allowed = {"graph_extracted", "vectorized", "status", "md_path", "chunk_count", "source_path", "source_mtime"}
        set_parts = []
        values = []
        for key, val in kwargs.items():
            if key in allowed:
                set_parts.append(f"{key} = ?")
                values.append(val)
        if not set_parts:
            return
        values.append(doc_id)
        await self._db.execute(
            f"UPDATE documents SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        await self._db.commit()

    async def update_document_source(self, doc_id: str, source_path: str, source_mtime: float) -> None:
        """更新文档的同步来源路径和修改时间"""
        await self._db.execute(
            "UPDATE documents SET source_path = ?, source_mtime = ? WHERE id = ?",
            (source_path, source_mtime, doc_id),
        )
        await self._db.commit()

    async def delete_document(self, doc_id: str) -> None:
        doc = await self.get_document(doc_id)
        if doc is None:
            return
        await self._db.execute("DELETE FROM chunks WHERE document_id = ?", (doc_id,))
        await self._db.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        # 更新 collection 计数
        await self._db.execute(
            "UPDATE collections SET document_count = document_count - 1, "
            "chunk_count = chunk_count - ? WHERE id = ?",
            (doc["chunk_count"], doc["collection_id"]),
        )
        await self._db.commit()

    # ── 批量重置文档状态 ──────────────────────────────────

    async def reset_document_vectorized(self, document_ids: list[str]) -> None:
        """批量重置文档的 vectorized=0 和 chunk_count=0，同步更新关联 collection 的 chunk_count"""
        for doc_id in document_ids:
            await self._db.execute(
                "UPDATE documents SET vectorized = 0, chunk_count = 0 WHERE id = ?",
                (doc_id,),
            )
            # 同步更新 collection 的 chunk_count（重新计算 SUM）
            await self._db.execute(
                "UPDATE collections SET chunk_count = ("
                "  SELECT COALESCE(SUM(chunk_count), 0) FROM documents WHERE collection_id = "
                "  (SELECT collection_id FROM documents WHERE id = ?)"
                ") WHERE id = (SELECT collection_id FROM documents WHERE id = ?)",
                (doc_id, doc_id),
            )
        await self._db.commit()

    async def reset_document_graph_extracted(self, document_ids: list[str]) -> None:
        """批量重置文档的 graph_extracted=0"""
        for doc_id in document_ids:
            await self._db.execute(
                "UPDATE documents SET graph_extracted = 0 WHERE id = ?",
                (doc_id,),
            )
        await self._db.commit()

    async def delete_chunks_by_document(self, document_id: str) -> int:
        """删除文档关联的所有 SQLite chunks 记录，返回删除数量"""
        cursor = await self._db.execute(
            "SELECT COUNT(*) as cnt FROM chunks WHERE document_id = ?", (document_id,)
        )
        row = await cursor.fetchone()
        count = row["cnt"] if row else 0
        await self._db.execute("DELETE FROM chunks WHERE document_id = ?", (document_id,))
        await self._db.commit()
        return count

    async def remove_document_from_graph_nodes(self, document_id: str) -> tuple[int, int]:
        """从图谱节点中移除文档引用，删除仅被该文档引用的节点及其关联边。

        chunk_ids 字段实际存储的是 document_id（而非 chunk_id）。
        返回 (deleted_nodes, deleted_edges)。
        """
        doc = await self.get_document(document_id)
        if not doc:
            return (0, 0)

        collection_id = doc["collection_id"]
        all_nodes = await self.get_graph_nodes(collection_id)

        deleted_nodes = 0
        deleted_edges = 0

        for node in all_nodes:
            node_chunk_ids = node.get("chunk_ids", [])
            if isinstance(node_chunk_ids, str):
                node_chunk_ids = json.loads(node_chunk_ids)

            if document_id not in node_chunk_ids:
                continue

            # 移除该 document_id
            new_chunk_ids = [cid for cid in node_chunk_ids if cid != document_id]

            if not new_chunk_ids:
                # 仅被此文档引用 → 删除节点及其关联边
                cursor = await self._db.execute(
                    "SELECT COUNT(*) as cnt FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?",
                    (node["id"], node["id"]),
                )
                row = await cursor.fetchone()
                edge_count = row["cnt"] if row else 0

                await self._db.execute(
                    "DELETE FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?",
                    (node["id"], node["id"]),
                )
                await self._db.execute(
                    "DELETE FROM graph_nodes WHERE id = ?", (node["id"],)
                )
                deleted_nodes += 1
                deleted_edges += edge_count
            else:
                # 被其他文档也引用 → 只更新 chunk_ids
                new_chunk_ids_json = json.dumps(new_chunk_ids, ensure_ascii=False)
                now = datetime.utcnow().isoformat()
                await self._db.execute(
                    "UPDATE graph_nodes SET chunk_ids = ?, updated_at = ? WHERE id = ?",
                    (new_chunk_ids_json, now, node["id"]),
                )

        await self._db.commit()
        return (deleted_nodes, deleted_edges)

    # ── Chunks CRUD ──────────────────────────────────────────

    async def create_chunk(
        self,
        document_id: str,
        collection_id: str,
        content: str,
        chunk_index: int,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        chunk_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()
        meta_json = json.dumps(metadata or {}, ensure_ascii=False)
        await self._db.execute(
            "INSERT INTO chunks (id, document_id, collection_id, content, chunk_index, metadata_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (chunk_id, document_id, collection_id, content, chunk_index, meta_json, now),
        )
        await self._db.commit()
        return {
            "id": chunk_id,
            "document_id": document_id,
            "collection_id": collection_id,
            "content": content,
            "chunk_index": chunk_index,
            "metadata": metadata or {},
            "created_at": now,
        }

    async def get_chunks_by_document(self, document_id: str) -> list[dict[str, Any]]:
        cursor = await self._db.execute(
            "SELECT * FROM chunks WHERE document_id = ? ORDER BY chunk_index",
            (document_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]

    async def get_chunks_by_ids(self, chunk_ids: list[str]) -> list[dict[str, Any]]:
        """根据 chunk ID 列表批量获取 chunks"""
        if not chunk_ids:
            return []
        placeholders = ",".join("?" * len(chunk_ids))
        cursor = await self._db.execute(
            f"SELECT * FROM chunks WHERE id IN ({placeholders})",
            chunk_ids,
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["metadata"] = json.loads(item.get("metadata_json", "{}"))
            results.append(item)
        return results

    # ── Graph Nodes CRUD ──────────────────────────────────────

    async def create_graph_node(
        self,
        collection_id: str,
        entity_text: str,
        entity_type: str,
        chunk_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        """创建或获取已存在的图谱节点（去重：同一collection下相同entity_text+entity_type）"""
        node_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()
        chunk_ids_json = json.dumps(chunk_ids or [], ensure_ascii=False)

        await self._db.execute(
            """INSERT OR IGNORE INTO graph_nodes
            (id, collection_id, entity_text, entity_type, chunk_ids, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (node_id, collection_id, entity_text, entity_type, chunk_ids_json, now, now),
        )
        await self._db.commit()

        # 返回实际节点（可能已存在）
        cursor = await self._db.execute(
            "SELECT * FROM graph_nodes WHERE collection_id = ? AND entity_text = ? AND entity_type = ?",
            (collection_id, entity_text, entity_type),
        )
        row = await cursor.fetchone()
        if row:
            result = dict(row)
            result["chunk_ids"] = json.loads(result["chunk_ids"])
            return result
        return {
            "id": node_id,
            "collection_id": collection_id,
            "entity_text": entity_text,
            "entity_type": entity_type,
            "chunk_ids": chunk_ids or [],
            "created_at": now,
            "updated_at": now,
        }

    async def update_graph_node(
        self,
        node_id: str,
        entity_text: str | None = None,
        entity_type: str | None = None,
        chunk_ids: list[str] | None = None,
    ) -> dict[str, Any] | None:
        """更新图谱节点"""
        node = await self.get_graph_node(node_id)
        if not node:
            return None
        now = datetime.utcnow().isoformat()
        new_text = entity_text if entity_text is not None else node["entity_text"]
        new_type = entity_type if entity_type is not None else node["entity_type"]
        new_chunks = json.dumps(chunk_ids, ensure_ascii=False) if chunk_ids is not None else json.dumps(node["chunk_ids"], ensure_ascii=False)

        await self._db.execute(
            "UPDATE graph_nodes SET entity_text = ?, entity_type = ?, chunk_ids = ?, updated_at = ? WHERE id = ?",
            (new_text, new_type, new_chunks, now, node_id),
        )
        await self._db.commit()
        return await self.get_graph_node(node_id)

    async def get_graph_node(self, node_id: str) -> dict[str, Any] | None:
        """获取单个图谱节点"""
        cursor = await self._db.execute("SELECT * FROM graph_nodes WHERE id = ?", (node_id,))
        row = await cursor.fetchone()
        if row:
            result = dict(row)
            result["chunk_ids"] = json.loads(result["chunk_ids"])
            return result
        return None

    async def get_graph_nodes(self, collection_id: str) -> list[dict[str, Any]]:
        """获取某个collection的所有图谱节点"""
        cursor = await self._db.execute(
            "SELECT * FROM graph_nodes WHERE collection_id = ? ORDER BY created_at",
            (collection_id,),
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["chunk_ids"] = json.loads(item["chunk_ids"])
            results.append(item)
        return results

    async def delete_graph_node(self, node_id: str) -> None:
        """删除图谱节点及其关联的边"""
        await self._db.execute(
            "DELETE FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?",
            (node_id, node_id),
        )
        await self._db.execute("DELETE FROM graph_nodes WHERE id = ?", (node_id,))
        await self._db.commit()

    async def delete_graph_by_collection(self, collection_id: str) -> None:
        """删除某个collection的所有图谱数据"""
        await self._db.execute("DELETE FROM graph_edges WHERE collection_id = ?", (collection_id,))
        await self._db.execute("DELETE FROM graph_nodes WHERE collection_id = ?", (collection_id,))
        await self._db.commit()

    # ── Graph Edges CRUD ──────────────────────────────────────

    async def create_graph_edge(
        self,
        collection_id: str,
        source_node_id: str,
        target_node_id: str,
        relation_type: str,
        evidence_chunks: list[str] | None = None,
        confidence: float = 1.0,
    ) -> dict[str, Any]:
        """创建图谱边（去重：同一collection下相同source+target+relation）"""
        edge_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()
        evidence_json = json.dumps(evidence_chunks or [], ensure_ascii=False)

        await self._db.execute(
            """INSERT OR IGNORE INTO graph_edges
            (id, collection_id, source_node_id, target_node_id, relation_type,
             confidence, evidence_chunks, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (edge_id, collection_id, source_node_id, target_node_id,
             relation_type, confidence, evidence_json, now, now),
        )
        await self._db.commit()

        # 返回实际边
        cursor = await self._db.execute(
            """SELECT * FROM graph_edges
            WHERE collection_id = ? AND source_node_id = ? AND target_node_id = ? AND relation_type = ?""",
            (collection_id, source_node_id, target_node_id, relation_type),
        )
        row = await cursor.fetchone()
        if row:
            result = dict(row)
            result["evidence_chunks"] = json.loads(result["evidence_chunks"])
            return result
        return {
            "id": edge_id,
            "collection_id": collection_id,
            "source_node_id": source_node_id,
            "target_node_id": target_node_id,
            "relation_type": relation_type,
            "confidence": confidence,
            "evidence_chunks": evidence_chunks or [],
            "created_at": now,
            "updated_at": now,
        }

    async def get_graph_edges(self, collection_id: str) -> list[dict[str, Any]]:
        """获取某个collection的所有图谱边"""
        cursor = await self._db.execute(
            "SELECT * FROM graph_edges WHERE collection_id = ? ORDER BY created_at",
            (collection_id,),
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["evidence_chunks"] = json.loads(item["evidence_chunks"])
            results.append(item)
        return results

    async def get_graph_nodes_by_document_ids(self, collection_id: str, document_ids: list[str]) -> list[dict[str, Any]]:
        """通过文档ID筛选图谱节点（chunk_ids字段实际存储的是document_id）"""
        if not document_ids:
            return []

        target_doc_ids = set(document_ids)

        # 获取该知识库所有节点，在Python层按document_id过滤
        all_nodes = await self.get_graph_nodes(collection_id)
        result = []
        for node in all_nodes:
            node_chunk_ids = node.get("chunk_ids", [])
            if isinstance(node_chunk_ids, str):
                node_chunk_ids = json.loads(node_chunk_ids)
            # chunk_ids 实际存储的是 document_id，直接比对
            if set(node_chunk_ids) & target_doc_ids:
                result.append(node)
        return result

    async def get_graph_edges_by_node_id(self, node_id: str) -> list[dict[str, Any]]:
        """获取与某个节点相关的所有边（source_node_id 或 target_node_id = node_id）"""
        cursor = await self._db.execute(
            "SELECT * FROM graph_edges WHERE source_node_id = ? OR target_node_id = ? ORDER BY created_at",
            (node_id, node_id),
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["evidence_chunks"] = json.loads(item["evidence_chunks"])
            results.append(item)
        return results

    async def get_graph_edges_by_node_ids(self, node_ids: list[str]) -> list[dict[str, Any]]:
        """根据节点ID列表获取相关边（两端都在列表中的边）"""
        if not node_ids:
            return []
        node_id_set = set(node_ids)
        # SQLite IN 子句分批处理
        batch_size = 450  # 两个 IN 子句各占一半参数位
        results: list[dict[str, Any]] = []
        for i in range(0, len(node_ids), batch_size):
            batch = node_ids[i:i + batch_size]
            placeholders = ",".join("?" * len(batch))
            cursor = await self._db.execute(
                f"SELECT * FROM graph_edges WHERE source_node_id IN ({placeholders}) OR target_node_id IN ({placeholders})",
                batch + batch,
            )
            rows = await cursor.fetchall()
            for r in rows:
                item = dict(r)
                # 只返回两端都在 node_ids 中的边
                if item["source_node_id"] in node_id_set and item["target_node_id"] in node_id_set:
                    if "evidence_chunks" in item:
                        item["evidence_chunks"] = json.loads(item["evidence_chunks"]) if isinstance(item["evidence_chunks"], str) else item["evidence_chunks"]
                    results.append(item)
        return results

    async def delete_graph_edge(self, edge_id: str) -> None:
        """删除图谱边"""
        await self._db.execute("DELETE FROM graph_edges WHERE id = ?", (edge_id,))
        await self._db.commit()

    async def get_all_graph_nodes(self) -> list[dict[str, Any]]:
        """获取所有知识库的图谱节点"""
        cursor = await self._db.execute(
            "SELECT * FROM graph_nodes ORDER BY created_at"
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["chunk_ids"] = json.loads(item["chunk_ids"])
            results.append(item)
        return results

    async def get_all_graph_edges(self) -> list[dict[str, Any]]:
        """获取所有知识库的图谱边"""
        cursor = await self._db.execute(
            "SELECT * FROM graph_edges ORDER BY created_at"
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["evidence_chunks"] = json.loads(item["evidence_chunks"])
            results.append(item)
        return results

    async def get_graph_stats(self, collection_id: str) -> dict[str, Any]:
        """获取图谱统计信息"""
        cursor = await self._db.execute(
            "SELECT COUNT(*) as cnt FROM graph_nodes WHERE collection_id = ?",
            (collection_id,),
        )
        row = await cursor.fetchone()
        node_count = row["cnt"] if row else 0

        cursor = await self._db.execute(
            "SELECT COUNT(*) as cnt FROM graph_edges WHERE collection_id = ?",
            (collection_id,),
        )
        row = await cursor.fetchone()
        edge_count = row["cnt"] if row else 0

        # 实体类型分布
        cursor = await self._db.execute(
            "SELECT entity_type, COUNT(*) as cnt FROM graph_nodes WHERE collection_id = ? GROUP BY entity_type",
            (collection_id,),
        )
        rows = await cursor.fetchall()
        type_distribution = {r["entity_type"]: r["cnt"] for r in rows}

        return {
            "node_count": node_count,
            "edge_count": edge_count,
            "entity_type_distribution": type_distribution,
        }


    # ── Extraction Tasks CRUD ─────────────────────────────────

    async def create_extraction_task(
        self, collection_id: str, document_ids: list[str] | None = None
    ) -> dict[str, Any]:
        """创建提取任务"""
        task_id = uuid.uuid4().hex
        now = datetime.utcnow().isoformat()
        doc_ids_json = json.dumps(document_ids or [], ensure_ascii=False)
        await self._db.execute(
            """INSERT INTO extraction_tasks
            (id, collection_id, document_ids, status, progress, current_step,
             total_chunks, processed_chunks, created_nodes, created_edges, error_message, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', 0.0, '', 0, 0, '[]', '[]', '', ?, ?)""",
            (task_id, collection_id, doc_ids_json, now, now),
        )
        await self._db.commit()
        return {"id": task_id, "collection_id": collection_id, "document_ids": document_ids or [],
                "status": "pending", "progress": 0.0, "current_step": "", "total_chunks": 0,
                "processed_chunks": 0, "created_nodes": [], "created_edges": [],
                "error_message": "", "created_at": now, "updated_at": now}

    async def get_extraction_task(self, task_id: str) -> dict[str, Any] | None:
        """获取单个任务"""
        cursor = await self._db.execute("SELECT * FROM extraction_tasks WHERE id = ?", (task_id,))
        row = await cursor.fetchone()
        if row:
            result = dict(row)
            result["document_ids"] = json.loads(result["document_ids"])
            result["created_nodes"] = json.loads(result["created_nodes"])
            result["created_edges"] = json.loads(result["created_edges"])
            return result
        return None

    async def get_active_extraction_tasks(self) -> list[dict[str, Any]]:
        """获取所有活跃任务（pending/running）"""
        cursor = await self._db.execute(
            "SELECT * FROM extraction_tasks WHERE status IN ('pending', 'running') ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["document_ids"] = json.loads(item["document_ids"])
            item["created_nodes"] = json.loads(item["created_nodes"])
            item["created_edges"] = json.loads(item["created_edges"])
            results.append(item)
        return results

    async def update_extraction_task(self, task_id: str, **kwargs) -> None:
        """更新任务字段"""
        now = datetime.utcnow().isoformat()
        set_parts = ["updated_at = ?"]
        values = [now]
        for key, val in kwargs.items():
            if key in ("status", "progress", "current_step", "total_chunks",
                       "processed_chunks", "error_message"):
                set_parts.append(f"{key} = ?")
                values.append(val)
            elif key in ("created_nodes", "created_edges"):
                set_parts.append(f"{key} = ?")
                values.append(json.dumps(val, ensure_ascii=False))
        values.append(task_id)
        await self._db.execute(
            f"UPDATE extraction_tasks SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        await self._db.commit()

    async def cancel_extraction_task(self, task_id: str) -> None:
        """标记任务为cancelled"""
        await self.update_extraction_task(task_id, status="cancelled")

    # ── Upload Tasks CRUD ──────────────────────────────────────

    async def create_upload_task(
        self, task_id: str, collection_id: str, filenames: list[str] | None = None
    ) -> dict[str, Any]:
        """创建上传任务"""
        now = datetime.utcnow().isoformat()
        filenames_json = json.dumps(filenames or [], ensure_ascii=False)
        await self._db.execute(
            """INSERT INTO upload_tasks
            (id, collection_id, filenames, status, progress, current_step,
             processed_files, total_files, created_doc_ids, error_message, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', 0.0, '', 0, 0, '[]', '', ?, ?)""",
            (task_id, collection_id, filenames_json, now, now),
        )
        await self._db.commit()
        return {"id": task_id, "collection_id": collection_id, "filenames": filenames or [],
                "status": "pending", "progress": 0.0, "current_step": "",
                "processed_files": 0, "total_files": 0, "created_doc_ids": [],
                "error_message": "", "created_at": now, "updated_at": now}

    async def get_upload_task(self, task_id: str) -> dict[str, Any] | None:
        """获取单个上传任务"""
        cursor = await self._db.execute("SELECT * FROM upload_tasks WHERE id = ?", (task_id,))
        row = await cursor.fetchone()
        if row:
            result = dict(row)
            result["filenames"] = json.loads(result["filenames"])
            result["created_doc_ids"] = json.loads(result["created_doc_ids"])
            return result
        return None

    async def update_upload_task(self, task_id: str, **kwargs) -> None:
        """更新上传任务字段"""
        now = datetime.utcnow().isoformat()
        set_parts = ["updated_at = ?"]
        values = [now]
        for key, val in kwargs.items():
            if key in ("status", "progress", "current_step", "processed_files",
                       "total_files", "error_message"):
                set_parts.append(f"{key} = ?")
                values.append(val)
            elif key in ("filenames", "created_doc_ids"):
                set_parts.append(f"{key} = ?")
                values.append(json.dumps(val, ensure_ascii=False))
        values.append(task_id)
        await self._db.execute(
            f"UPDATE upload_tasks SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        await self._db.commit()

    async def get_active_upload_tasks(self) -> list[dict[str, Any]]:
        """获取所有活跃上传任务（pending/running）"""
        cursor = await self._db.execute(
            "SELECT * FROM upload_tasks WHERE status IN ('pending', 'running') ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["filenames"] = json.loads(item["filenames"])
            item["created_doc_ids"] = json.loads(item["created_doc_ids"])
            results.append(item)
        return results

    # ── Vectorize Tasks CRUD ───────────────────────────────────

    async def create_vectorize_task(
        self, task_id: str, collection_id: str, document_ids: list[str] | None = None
    ) -> dict[str, Any]:
        """创建向量化任务"""
        now = datetime.utcnow().isoformat()
        doc_ids_json = json.dumps(document_ids or [], ensure_ascii=False)
        await self._db.execute(
            """INSERT INTO vectorize_tasks
            (id, collection_id, document_ids, status, progress, current_step,
             total_chunks, processed_chunks, created_chunk_ids, error_message, created_at, updated_at)
            VALUES (?, ?, ?, 'pending', 0.0, '', 0, 0, '[]', '', ?, ?)""",
            (task_id, collection_id, doc_ids_json, now, now),
        )
        await self._db.commit()
        return {"id": task_id, "collection_id": collection_id, "document_ids": document_ids or [],
                "status": "pending", "progress": 0.0, "current_step": "",
                "total_chunks": 0, "processed_chunks": 0, "created_chunk_ids": [],
                "error_message": "", "created_at": now, "updated_at": now}

    async def get_vectorize_task(self, task_id: str) -> dict[str, Any] | None:
        """获取单个向量化任务"""
        cursor = await self._db.execute("SELECT * FROM vectorize_tasks WHERE id = ?", (task_id,))
        row = await cursor.fetchone()
        if row:
            result = dict(row)
            result["document_ids"] = json.loads(result["document_ids"])
            result["created_chunk_ids"] = json.loads(result["created_chunk_ids"])
            return result
        return None

    async def update_vectorize_task(self, task_id: str, **kwargs) -> None:
        """更新向量化任务字段"""
        now = datetime.utcnow().isoformat()
        set_parts = ["updated_at = ?"]
        values = [now]
        for key, val in kwargs.items():
            if key in ("status", "progress", "current_step", "total_chunks",
                       "processed_chunks", "error_message"):
                set_parts.append(f"{key} = ?")
                values.append(val)
            elif key in ("document_ids", "created_chunk_ids"):
                set_parts.append(f"{key} = ?")
                values.append(json.dumps(val, ensure_ascii=False))
        values.append(task_id)
        await self._db.execute(
            f"UPDATE vectorize_tasks SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        await self._db.commit()

    async def get_active_vectorize_tasks(self) -> list[dict[str, Any]]:
        """获取所有活跃向量化任务（pending/running）"""
        cursor = await self._db.execute(
            "SELECT * FROM vectorize_tasks WHERE status IN ('pending', 'running') ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["document_ids"] = json.loads(item["document_ids"])
            item["created_chunk_ids"] = json.loads(item["created_chunk_ids"])
            results.append(item)
        return results

    # ── Integration Services ─────────────────────────────────

    async def list_integration_services(self) -> list[dict[str, Any]]:
        """列出所有对接服务"""
        async with self._db.execute(
            "SELECT * FROM integration_services ORDER BY created_at DESC"
        ) as cursor:
            rows = await cursor.fetchall()
            results = []
            for row in rows:
                item = dict(row)
                item["collections"] = json.loads(item.get("collections", "[]"))
                results.append(item)
            return results

    async def get_integration_service(self, service_id: str) -> dict[str, Any] | None:
        """获取单个对接服务"""
        async with self._db.execute(
            "SELECT * FROM integration_services WHERE id = ?", (service_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if row is None:
                return None
            item = dict(row)
            item["collections"] = json.loads(item.get("collections", "[]"))
            return item

    async def create_integration_service(self, data: dict[str, Any]) -> dict[str, Any]:
        """创建对接服务"""
        service_id = str(uuid.uuid4())
        now = datetime.now().isoformat()
        collections_json = json.dumps(data.get("collections", []), ensure_ascii=False)
        await self._db.execute(
            """INSERT INTO integration_services (id, name, agent_type, enabled, collections, retrieval_mode, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (service_id, data["name"], data["agent_type"], 1, collections_json, data.get("retrieval_mode", "vector"), now, now),
        )
        await self._db.commit()
        return await self.get_integration_service(service_id)

    async def update_integration_service(self, service_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
        """更新对接服务"""
        existing = await self.get_integration_service(service_id)
        if existing is None:
            return None
        now = datetime.now().isoformat()
        updates = []
        params = []
        for key in ("name", "agent_type", "enabled", "retrieval_mode"):
            if key in data:
                updates.append(f"{key} = ?")
                params.append(data[key])
        if "collections" in data:
            updates.append("collections = ?")
            params.append(json.dumps(data["collections"], ensure_ascii=False))
        if not updates:
            return existing
        updates.append("updated_at = ?")
        params.append(now)
        params.append(service_id)
        await self._db.execute(
            f"UPDATE integration_services SET {', '.join(updates)} WHERE id = ?",
            params,
        )
        await self._db.commit()
        return await self.get_integration_service(service_id)

    async def delete_integration_service(self, service_id: str) -> bool:
        """删除对接服务"""
        async with self._db.execute(
            "DELETE FROM integration_services WHERE id = ?", (service_id,)
        ) as cursor:
            await self._db.commit()
            return cursor.rowcount > 0


    # ── Sync Folders CRUD ──────────────────────────────────────

    async def create_sync_folder(
        self,
        sync_id: str,
        collection_id: str,
        folder_path: str,
        poll_interval: int = 30,
        auto_vectorize: int = 0,
        auto_extract: int = 0,
        file_filter: str = '',
        ignore_patterns: str = '[]',
    ) -> dict[str, Any]:
        """创建同步文件夹配置"""
        now = datetime.now().isoformat()
        await self._db.execute(
            """
            INSERT INTO sync_folders
            (id, collection_id, folder_path, poll_interval, auto_vectorize, auto_extract,
             file_filter, ignore_patterns, active, last_synced_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
            """,
            (sync_id, collection_id, folder_path, poll_interval, auto_vectorize,
             auto_extract, file_filter, ignore_patterns, now, now),
        )
        await self._db.commit()
        return await self.get_sync_folder(sync_id)

    async def get_sync_folder(self, sync_id: str) -> dict[str, Any] | None:
        """获取单个同步文件夹配置"""
        cursor = await self._db.execute(
            "SELECT * FROM sync_folders WHERE id = ?", (sync_id,)
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        result["ignore_patterns"] = json.loads(result.get("ignore_patterns", "[]"))
        return result

    async def update_sync_folder(self, sync_id: str, **kwargs) -> dict[str, Any] | None:
        """通用更新同步文件夹配置字段，自动设置 updated_at"""
        now = datetime.now().isoformat()
        set_parts = ["updated_at = ?"]
        values: list[Any] = [now]
        json_fields = {"ignore_patterns"}
        scalar_fields = {"poll_interval", "auto_vectorize", "auto_extract",
                         "file_filter", "active", "last_synced_at", "folder_path"}
        for key, val in kwargs.items():
            if key in json_fields:
                set_parts.append(f"{key} = ?")
                values.append(json.dumps(val, ensure_ascii=False) if not isinstance(val, str) else val)
            elif key in scalar_fields:
                set_parts.append(f"{key} = ?")
                values.append(val)
        if len(set_parts) == 1:
            return await self.get_sync_folder(sync_id)
        values.append(sync_id)
        await self._db.execute(
            f"UPDATE sync_folders SET {', '.join(set_parts)} WHERE id = ?",
            values,
        )
        await self._db.commit()
        return await self.get_sync_folder(sync_id)

    async def delete_sync_folder(self, sync_id: str) -> None:
        """删除同步文件夹配置"""
        await self._db.execute("DELETE FROM sync_folders WHERE id = ?", (sync_id,))
        await self._db.commit()

    async def get_sync_folders_by_collection(
        self, collection_id: str
    ) -> list[dict[str, Any]]:
        """获取指定知识库的所有同步文件夹配置"""
        cursor = await self._db.execute(
            "SELECT * FROM sync_folders WHERE collection_id = ? ORDER BY created_at DESC",
            (collection_id,),
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["ignore_patterns"] = json.loads(item.get("ignore_patterns", "[]"))
            results.append(item)
        return results

    async def get_active_sync_folders(self) -> list[dict[str, Any]]:
        """获取所有 active=1 的同步文件夹配置"""
        cursor = await self._db.execute(
            "SELECT * FROM sync_folders WHERE active = 1 ORDER BY created_at DESC"
        )
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            item = dict(r)
            item["ignore_patterns"] = json.loads(item.get("ignore_patterns", "[]"))
            results.append(item)
        return results

    async def get_document_by_source_path(
        self, collection_id: str, source_path: str
    ) -> dict[str, Any] | None:
        """按 collection_id + source_path 查找文档"""
        cursor = await self._db.execute(
            "SELECT * FROM documents WHERE collection_id = ? AND source_path = ?",
            (collection_id, source_path),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None

    async def get_documents_with_source_path(
        self, collection_id: str
    ) -> list[dict[str, Any]]:
        """获取该知识库中所有 source_path 非空的文档"""
        cursor = await self._db.execute(
            "SELECT * FROM documents WHERE collection_id = ? AND source_path != '' ORDER BY created_at DESC",
            (collection_id,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# 全局单例
db_manager = DatabaseManager()
