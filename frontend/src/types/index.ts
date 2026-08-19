export interface Collection {
  id: string;
  name: string;
  description: string;
  document_count: number;
  chunk_count: number;
  chunk_size: number;
  chunk_overlap: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCollectionRequest {
  name: string;
  description: string;
  chunk_size?: number;
  chunk_overlap?: number;
}

export interface Document {
  id: string;
  collection_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: string;
  error_message?: string;
  md_path: string | null;
  vectorized: number;  // 0 或 1
  graph_extracted: number;  // 0 或 1
  created_at: string;
  updated_at: string;
}

export interface Chunk {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SearchResult {
  content: string;
  score: number;
  document_id: string;
  document_name: string;
  collection_name: string;
  chunk_index: number;
  metadata: Record<string, unknown>;
}

export interface SearchRequest {
  query: string;
  collection_name?: string;
  top_k?: number;
  score_threshold?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total: number;
}

// ── Knowledge Graph ─────────────────────────────────────

export interface GraphNode {
  id: string;
  collection_id: string;
  entity_text: string;
  entity_type: string;
  chunk_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  collection_id: string;
  source_node_id: string;
  target_node_id: string;
  relation_type: string;
  confidence: number;
  evidence_chunks: string[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgeGraphData {
  collection_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphStats {
  node_count: number;
  edge_count: number;
  entity_type_distribution: Record<string, number>;
}

export interface NodeDetailChunk {
  chunk_id: string;
  content: string;
  document_id: string;
  document_name: string;
  chunk_index: number;
}

export interface NodeDetailEdge {
  id: string;
  relation_type: string;
  source_node_id: string;
  target_node_id: string;
  source_text: string;
  target_text: string;
  confidence: number;
  direction: 'outgoing' | 'incoming';
}

export interface NodeDetailResponse {
  node: GraphNode;
  source_chunks: NodeDetailChunk[];
  related_edges: NodeDetailEdge[];
}

export interface LLMConfig {
  base_url: string;
  api_key: string;
  model: string;
  temperature?: number;
  max_tokens?: number;
}

export interface ExtractRequest {
  collection_id: string;
  document_id?: string;
  llm_config?: Partial<LLMConfig>;
}

export interface HybridSearchParams {
  query: string;
  collection_name?: string;
  use_vector?: boolean;
  use_graph?: boolean;
  top_k?: number;
  score_threshold?: number;
}

// ── Settings ─────────────────────────────────────────────

export interface SettingsResponse {
  system_name: string;
  system_version: string;
  llm_base_url: string;
  llm_api_key: string;
  llm_model_name: string;
  logo_url: string | null;
  graph_max_gleanings: number;
  graph_dedup_enabled: boolean;
  graph_confidence_filter: boolean;
  graph_confidence_threshold: number;
}

export interface SettingsUpdate {
  system_name?: string;
  llm_base_url?: string;
  llm_api_key?: string;
  llm_model_name?: string;
  graph_max_gleanings?: number;
  graph_dedup_enabled?: boolean;
  graph_confidence_filter?: boolean;
  graph_confidence_threshold?: number;
}

// ── System Status ─────────────────────────────────────

export interface ComponentStatus {
  status: string;
  [key: string]: unknown;
}

export interface BackendStatus {
  status: string;
  uptime: string;
  uptime_seconds: number;
  version: string;
}

export interface EmbeddingModelStatus {
  status: string;
  model_name: string;
  device: string;
  loaded: boolean;
}

export interface VectorDBStatus {
  status: string;
  collections: number;
  total_vectors: number;
  error?: string;
}

export interface OCREngineStatus {
  status: string;
  engine: string;
  tesseract: boolean;
  easyocr: boolean;
}

export interface DatabaseStatus {
  status: string;
  size_mb: number;
  path: string;
}

export interface SystemStatus {
  backend: BackendStatus;
  embedding_model: EmbeddingModelStatus;
  vector_db: VectorDBStatus;
  ocr_engine: OCREngineStatus;
  database: DatabaseStatus;
}

// ── Dashboard Graph Stats ─────────────────────────────────

export interface DiskUsage {
  chroma_mb: number;
  sqlite_mb: number;
  markdown_mb: number;
  uploads_mb: number;
  total_mb: number;
}

export interface DashboardGraphStats {
  total_entities: number;
  total_relations: number;
  entity_type_distribution: Record<string, number>;
  disk_usage: DiskUsage;
}

// ── Chat ─────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  references?: ChatReference[];
  isStreaming?: boolean;
  timestamp: number;
}

export interface ChatReference {
  content: string;
  score: number;
  document_id: string;
  metadata: Record<string, unknown>;
}

export interface ChatRequest {
  query: string;
  collection_name?: string;
  conversation_history: { role: string; content: string }[];
  use_hybrid?: boolean;
  top_k?: number;
}

// ── Upload Task ─────────────────────────────────────

export interface UploadTask {
  id: string;
  collection_id: string;
  filenames: string[];
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  current_step: string;
  processed_files: number;
  total_files: number;
  created_doc_ids: string[];
  error_message: string;
  created_at: string;
  updated_at: string;
}

// ── Vectorize Task ─────────────────────────────────────

export interface VectorizeTask {
  id: string;
  collection_id: string;
  document_ids: string[];
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  current_step: string;
  total_chunks: number;
  processed_chunks: number;
  created_chunk_ids: string[];
  error_message: string;
  created_at: string;
  updated_at: string;
}

// ── Extraction Task ─────────────────────────────────────

export interface ExtractionTask {
  id: string;
  collection_id: string;
  document_ids: string[];
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  progress: number;
  current_step: string;
  total_chunks: number;
  processed_chunks: number;
  error_message: string;
  created_at: string;
  updated_at: string;
}

// ── Directory Sync ─────────────────────────────────────

export interface SyncFolder {
  id: string;
  collection_id: string;
  folder_path: string;
  poll_interval: number;
  auto_vectorize: number;
  auto_extract: number;
  file_filter: string;
  ignore_patterns: string[];
  active: number;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
}

export interface SyncFolderCreate {
  folder_path: string;
  poll_interval?: number;
  auto_vectorize?: number;
  auto_extract?: number;
  file_filter?: string;
  ignore_patterns?: string[];
}

export interface SyncFolderUpdate {
  poll_interval?: number;
  auto_vectorize?: number;
  auto_extract?: number;
  file_filter?: string;
  ignore_patterns?: string[];
  active?: number;
}

// ── Integration Services ─────────────────────────────────────

export interface IntegrationService {
  id: string;
  name: string;
  agent_type: 'claude_code' | 'codex' | 'hermes';
  enabled: boolean;
  collections: string[];
  retrieval_mode: 'vector' | 'graph' | 'hybrid';
  created_at: string;
  updated_at: string;
}

export interface IntegrationServiceCreate {
  name: string;
  agent_type: 'claude_code' | 'codex' | 'hermes';
  retrieval_mode: 'vector' | 'graph' | 'hybrid';
  collections: string[];
}

export interface IntegrationConfig {
  service_name: string;
  agent_type: string;
  retrieval_mode: string;
  config_json: Record<string, unknown>;
  config_path: string;
  instructions: string[];
  verification: string;
}
