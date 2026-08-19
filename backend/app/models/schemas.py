"""RAG2.0 Pydantic 数据模型"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field


# ── 枚举 ──────────────────────────────────────────────────────


class DocumentStatus(str, Enum):
    PROCESSING = "processing"
    READY = "ready"
    ERROR = "error"


class ChunkingStrategy(str, Enum):
    RECURSIVE = "recursive"
    MARKDOWN = "markdown"


# ── Collection ────────────────────────────────────────────────


class CollectionCreate(BaseModel):
    """创建知识库请求体"""

    name: str = Field(..., min_length=1, max_length=128, description="知识库名称")
    description: str = Field(default="", max_length=512, description="知识库描述")
    chunk_size: int = Field(default=512, ge=128, le=2048, description="分块大小（字符数）")
    chunk_overlap: int = Field(default=50, ge=0, description="分块重叠（字符数）")


class CollectionResponse(BaseModel):
    """知识库响应体"""

    id: str
    name: str
    description: str
    created_at: datetime
    document_count: int = 0
    chunk_count: int = 0
    chunk_size: int = 512
    chunk_overlap: int = 50


# ── Document ──────────────────────────────────────────────────


class DocumentResponse(BaseModel):
    """文档响应体"""

    id: str
    collection_id: str
    filename: str
    file_type: str
    file_size: int
    md_path: str | None = None
    vectorized: int = 0
    graph_extracted: int = 0
    status: DocumentStatus
    created_at: datetime
    chunk_count: int = 0


# ── Chunk ─────────────────────────────────────────────────────


class BatchDeleteRequest(BaseModel):
    """批量删除文档请求体"""

    document_ids: list[str] = Field(..., min_length=1, description="要删除的文档ID列表")


class BatchDeleteResponse(BaseModel):
    """批量删除文档响应体"""

    deleted: int = 0
    failed: int = 0
    errors: list[str] = Field(default_factory=list)


class BatchDeleteVectorsRequest(BaseModel):
    """批量删除向量请求体"""

    document_ids: list[str] = Field(..., min_length=1, description="要删除向量的文档ID列表")


class BatchDeleteVectorsResponse(BaseModel):
    """批量删除向量响应体"""

    success: bool = True
    deleted_count: int = 0


class BatchDeleteGraphRequest(BaseModel):
    """批量删除图谱数据请求体"""

    document_ids: list[str] = Field(..., min_length=1, description="要删除图谱数据的文档ID列表")


class BatchDeleteGraphResponse(BaseModel):
    """批量删除图谱数据响应体"""

    success: bool = True
    deleted_nodes: int = 0
    deleted_edges: int = 0


class ChunkResponse(BaseModel):
    """分块响应体"""

    id: str
    document_id: str
    collection_id: str
    content: str
    chunk_index: int
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


# ── Search ────────────────────────────────────────────────────


class SearchQuery(BaseModel):
    """检索请求体"""

    query: str = Field(..., min_length=1, description="查询文本")
    collection_name: str | None = Field(default=None, description="知识库名称，不传则搜索所有")
    top_k: int = Field(default=5, ge=1, le=50, description="返回结果数量")
    score_threshold: float = Field(default=0.0, ge=0.0, le=1.0, description="最低相似度阈值")


class SearchResultItem(BaseModel):
    """检索结果条目"""

    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)
    document_id: str = ""
    chunk_index: int = 0


class SearchResponse(BaseModel):
    """检索响应体"""

    query: str
    results: list[SearchResultItem] = Field(default_factory=list)
    total: int = 0


# ── Knowledge Graph ──────────────────────────────────────


class GraphNodeCreate(BaseModel):
    """创建图谱节点请求体"""

    entity_text: str = Field(..., min_length=1, max_length=256, description="实体文本")
    entity_type: str = Field(..., min_length=1, max_length=64, description="实体类型")
    chunk_ids: list[str] = Field(default_factory=list, description="关联chunk IDs")


class GraphNodeUpdate(BaseModel):
    """更新图谱节点请求体"""

    entity_text: str | None = Field(default=None, max_length=256, description="实体文本")
    entity_type: str | None = Field(default=None, max_length=64, description="实体类型")
    chunk_ids: list[str] | None = Field(default=None, description="关联chunk IDs")


class GraphNodeResponse(BaseModel):
    """图谱节点响应体"""

    id: str
    collection_id: str
    entity_text: str
    entity_type: str
    chunk_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class GraphEdgeCreate(BaseModel):
    """创建图谱边请求体"""

    source_node_id: str = Field(..., description="源节点ID")
    target_node_id: str = Field(..., description="目标节点ID")
    relation_type: str = Field(..., min_length=1, max_length=128, description="关系类型")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0, description="置信度")
    evidence_chunks: list[str] = Field(default_factory=list, description="证据chunk IDs")


class GraphEdgeResponse(BaseModel):
    """图谱边响应体"""

    id: str
    collection_id: str
    source_node_id: str
    target_node_id: str
    relation_type: str
    confidence: float = 1.0
    evidence_chunks: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class KnowledgeGraphResponse(BaseModel):
    """完整知识图谱响应体"""

    collection_id: str
    nodes: list[GraphNodeResponse] = Field(default_factory=list)
    edges: list[GraphEdgeResponse] = Field(default_factory=list)


class GraphStatsResponse(BaseModel):
    """图谱统计响应体"""

    node_count: int = 0
    edge_count: int = 0
    entity_type_distribution: dict[str, int] = Field(default_factory=dict)


class ExtractRequest(BaseModel):
    """实体提取请求体（旧版，保留兼容）"""

    collection_id: str = Field(..., description="知识库ID")
    document_id: str | None = Field(default=None, description="文档ID，不传则提取整个collection")
    llm_config: dict[str, Any] | None = Field(default=None, description="可选LLM配置覆盖")


class ExtractRequestV2(BaseModel):
    """实体提取请求体（v2：支持多文档）"""
    collection_id: str = Field(..., description="知识库ID")
    document_ids: list[str] = Field(default_factory=list, description="文档ID列表，空=整个知识库")


class ExtractionTaskResponse(BaseModel):
    """提取任务响应体"""
    id: str
    collection_id: str
    document_ids: list[str] = Field(default_factory=list)
    status: str  # pending/running/completed/cancelled/failed
    progress: float = 0.0
    current_step: str = ""
    total_chunks: int = 0
    processed_chunks: int = 0
    error_message: str = ""
    created_at: datetime
    updated_at: datetime


class UploadTaskResponse(BaseModel):
    """上传任务响应体"""
    id: str
    collection_id: str
    filenames: list[str] = Field(default_factory=list)
    status: str  # pending/running/completed/failed
    progress: float = 0.0
    current_step: str = ""
    processed_files: int = 0
    total_files: int = 0
    created_doc_ids: list[str] = Field(default_factory=list)
    error_message: str = ""
    created_at: datetime
    updated_at: datetime


class VectorizeTaskResponse(BaseModel):
    """向量化任务响应体"""
    id: str
    collection_id: str
    document_ids: list[str] = Field(default_factory=list)
    status: str  # pending/running/completed/failed
    progress: float = 0.0
    current_step: str = ""
    total_chunks: int = 0
    processed_chunks: int = 0
    created_chunk_ids: list[str] = Field(default_factory=list)
    error_message: str = ""
    created_at: datetime
    updated_at: datetime


class VectorizeRequest(BaseModel):
    """向量化请求体"""
    document_ids: list[str] = Field(..., min_length=1, description="要向量化的文档ID列表")


class HybridSearchQuery(BaseModel):
    """混合检索请求体"""

    query: str = Field(..., min_length=1, description="查询文本")
    collection_name: str | None = Field(default=None, description="知识库名称")
    use_vector: bool = Field(default=True, description="是否使用向量检索")
    use_graph: bool = Field(default=True, description="是否使用图谱检索")
    top_k: int = Field(default=5, ge=1, le=50, description="返回结果数量")
    score_threshold: float = Field(default=0.0, ge=0.0, le=1.0, description="最低分数阈值")


# ── Settings ────────────────────────────────────────────────


class SettingsUpdate(BaseModel):
    """更新系统配置请求体"""

    system_name: str | None = Field(default=None, max_length=128, description="系统名称")
    llm_base_url: str | None = Field(default=None, description="LLM Base URL")
    llm_api_key: str | None = Field(default=None, description="LLM API Key")
    llm_model_name: str | None = Field(default=None, description="LLM 模型名称")
    graph_max_gleanings: int | None = Field(default=None, ge=0, le=3, description="Gleaning追问轮数(0-3)")
    graph_dedup_enabled: bool | None = Field(default=None, description="是否启用实体模糊去重")
    graph_confidence_filter: bool | None = Field(default=None, description="是否启用置信度过滤")
    graph_confidence_threshold: float | None = Field(default=None, ge=0.0, le=1.0, description="置信度过滤阈值")


class SettingsResponse(BaseModel):
    """系统配置响应体"""

    system_name: str
    system_version: str
    llm_base_url: str
    llm_api_key: str  # 返回时脱敏，只显示最后4位
    llm_model_name: str
    logo_url: str | None
    graph_max_gleanings: int = 1
    graph_dedup_enabled: bool = True
    graph_confidence_filter: bool = True
    graph_confidence_threshold: float = 0.6


# ── Chat ────────────────────────────────────────────────────


class ChatMessage(BaseModel):
    """聊天消息"""

    role: str = Field(..., description="角色: user 或 assistant")
    content: str = Field(..., description="消息内容")


class ChatRequest(BaseModel):
    """聊天请求体"""

    query: str = Field(..., min_length=1, description="用户问题")
    collection_name: str | None = Field(default=None, description="知识库名称，不传则搜索所有")
    conversation_history: list[ChatMessage] = Field(default_factory=list, description="对话历史")
    use_hybrid: bool = Field(default=True, description="是否使用混合检索（向量+图谱）")
    top_k: int = Field(default=5, ge=1, le=20, description="检索结果数量")


# ── Integration Services ─────────────────────────────────────

class IntegrationServiceCreate(BaseModel):
    """创建对接服务请求体"""
    name: str = Field(..., min_length=1, max_length=128, description="服务名称")
    agent_type: str = Field(..., description="Agent类型: claude_code / codex / hermes")
    retrieval_mode: str = Field(default="vector", description="检索方式: vector / graph / hybrid")
    collections: list[str] = Field(default_factory=list, description="关联知识库ID列表，空表示全部")


class IntegrationServiceUpdate(BaseModel):
    """更新对接服务请求体"""
    name: str | None = Field(default=None, max_length=128, description="服务名称")
    agent_type: str | None = Field(default=None, description="Agent类型")
    enabled: bool | None = Field(default=None, description="是否启用")
    retrieval_mode: str | None = Field(default=None, description="检索方式")
    collections: list[str] | None = Field(default=None, description="关联知识库ID列表")


class IntegrationServiceResponse(BaseModel):
    """对接服务响应体"""
    id: str
    name: str
    agent_type: str
    enabled: bool
    collections: list[str] = Field(default_factory=list)
    retrieval_mode: str = "vector"
    created_at: datetime
    updated_at: datetime


class IntegrationConfigResponse(BaseModel):
    """对接配置生成响应体"""
    service_name: str
    agent_type: str
    retrieval_mode: str
    config_json: dict[str, Any] = Field(default_factory=dict, description="MCP配置JSON")
    config_path: str = Field(default="", description="配置文件路径")
    instructions: list[str] = Field(default_factory=list, description="对接步骤说明")
    verification: str = Field(default="", description="验证方法")


# ── Sync Folders ────────────────────────────────────


class SyncFolderCreate(BaseModel):
    """创建同步文件夹请求体"""
    folder_path: str
    poll_interval: int = 30
    auto_vectorize: int = 0
    auto_extract: int = 0
    file_filter: str = ''
    ignore_patterns: List[str] = []


class SyncFolderUpdate(BaseModel):
    """更新同步文件夹请求体"""
    poll_interval: Optional[int] = None
    auto_vectorize: Optional[int] = None
    auto_extract: Optional[int] = None
    file_filter: Optional[str] = None
    ignore_patterns: Optional[List[str]] = None
    active: Optional[int] = None


class SyncFolderResponse(BaseModel):
    """同步文件夹响应体"""
    id: str
    collection_id: str
    folder_path: str
    poll_interval: int
    auto_vectorize: int
    auto_extract: int
    file_filter: str
    ignore_patterns: List[str]
    active: int
    last_synced_at: str
    created_at: str
    updated_at: str
