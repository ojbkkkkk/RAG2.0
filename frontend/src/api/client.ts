import axios from 'axios';
import type {
  Collection,
  CreateCollectionRequest,
  Document,
  Chunk,
  SearchRequest,
  SearchResponse,
  KnowledgeGraphData,
  GraphStats,
  GraphNode,
  GraphEdge,
  ExtractRequest,
  ExtractionTask,
  UploadTask,
  VectorizeTask,
  HybridSearchParams,
  SystemStatus,
  DashboardGraphStats,
  SettingsResponse,
  SettingsUpdate,
  ChatReference,
  IntegrationService,
  IntegrationServiceCreate,
  IntegrationConfig,
  NodeDetailResponse,
  SyncFolder,
  SyncFolderCreate,
  SyncFolderUpdate,
} from '../types';

const api = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 300000,
});

// ========== Collections ==========

export const getCollections = async (): Promise<Collection[]> => {
  const res = await api.get('/api/collections');
  return res.data;
};

export const getCollection = async (id: string): Promise<Collection> => {
  const res = await api.get(`/api/collections/${id}`);
  return res.data;
};

export const createCollection = async (data: CreateCollectionRequest): Promise<Collection> => {
  const res = await api.post('/api/collections', data);
  return res.data;
};

export const deleteCollection = async (id: string): Promise<void> => {
  await api.delete(`/api/collections/${id}`);
};

// ========== Documents ==========

export const getDocuments = async (collectionId: string): Promise<Document[]> => {
  const res = await api.get(`/api/collections/${collectionId}/documents`);
  return res.data;
};

export const getDocument = async (id: string): Promise<Document> => {
  const res = await api.get(`/api/documents/${id}`);
  return res.data;
};

export const getDocumentChunks = async (id: string): Promise<Chunk[]> => {
  const res = await api.get(`/api/documents/${id}/chunks`);
  return res.data;
};

export const deleteDocument = async (id: string): Promise<void> => {
  await api.delete(`/api/documents/${id}`);
};

export const batchDeleteDocuments = async (
  documentIds: string[]
): Promise<{ deleted: number; failed: number; errors: string[] }> => {
  const res = await api.delete('/api/documents/batch', { data: { document_ids: documentIds } });
  return res.data;
};

export async function deleteDocumentVectors(documentIds: string[]): Promise<{ success: boolean; deleted_count: number }> {
  const res = await api.post('/api/documents/delete-vectors', { document_ids: documentIds });
  return res.data;
}

export async function deleteDocumentGraph(documentIds: string[]): Promise<{ success: boolean; deleted_nodes: number; deleted_edges: number }> {
  const res = await api.post('/api/documents/delete-graph', { document_ids: documentIds });
  return res.data;
}

// ========== Search ==========

export const search = async (params: SearchRequest): Promise<SearchResponse> => {
  const res = await api.post('/api/search', params);
  return res.data;
};

export const getSupportedFormats = async (): Promise<string[]> => {
  const res = await api.get('/api/search/supported-formats');
  return res.data;
};

// ========== Knowledge Graph ==========

export const getKnowledgeGraph = async (collectionId: string, documentIds?: string[]): Promise<KnowledgeGraphData> => {
  let url = `/api/knowledge-graph/${collectionId}`;
  if (documentIds && documentIds.length > 0) {
    const params = documentIds.map(id => `document_ids=${encodeURIComponent(id)}`).join('&');
    url += `?${params}`;
  }
  const res = await api.get(url);
  return res.data;
};

export const getGraphStats = async (collectionId: string): Promise<GraphStats> => {
  const res = await api.get(`/api/knowledge-graph/${collectionId}/stats`);
  return res.data;
};

export const extractEntities = async (params: ExtractRequest): Promise<{ status: string; message: string }> => {
  const res = await api.post('/api/knowledge-graph/extract', params);
  return res.data;
};

export const createGraphNode = async (
  collectionId: string,
  data: { entity_text: string; entity_type: string; chunk_ids?: string[] }
): Promise<GraphNode> => {
  const res = await api.post(`/api/knowledge-graph/${collectionId}/nodes`, data);
  return res.data;
};

export const updateGraphNode = async (
  collectionId: string,
  nodeId: string,
  data: { entity_text?: string; entity_type?: string; chunk_ids?: string[] }
): Promise<GraphNode> => {
  const res = await api.put(`/api/knowledge-graph/${collectionId}/nodes/${nodeId}`, data);
  return res.data;
};

export const deleteGraphNode = async (collectionId: string, nodeId: string): Promise<void> => {
  await api.delete(`/api/knowledge-graph/${collectionId}/nodes/${nodeId}`);
};

export const createGraphEdge = async (
  collectionId: string,
  data: { source_node_id: string; target_node_id: string; relation_type: string; confidence?: number; evidence_chunks?: string[] }
): Promise<GraphEdge> => {
  const res = await api.post(`/api/knowledge-graph/${collectionId}/edges`, data);
  return res.data;
};

export const deleteGraphEdge = async (collectionId: string, edgeId: string): Promise<void> => {
  await api.delete(`/api/knowledge-graph/${collectionId}/edges/${edgeId}`);
};

export const hybridSearch = async (params: HybridSearchParams): Promise<SearchResponse> => {
  const res = await api.post('/api/search/hybrid', params);
  return res.data;
};

export async function getNodeDetail(nodeId: string): Promise<NodeDetailResponse> {
  const res = await api.get(`/api/knowledge-graph/nodes/${nodeId}/detail`);
  return res.data;
}

export const searchGraph = async (params: { query: string; collection_name?: string; top_k?: number; score_threshold?: number }): Promise<SearchResponse> => {
  const res = await api.post('/api/search/graph', params);
  return res.data;
};

export const searchHybrid = async (params: { query: string; collection_name?: string; top_k?: number; score_threshold?: number; use_vector?: boolean; use_graph?: boolean }): Promise<SearchResponse> => {
  const res = await api.post('/api/search/hybrid', params);
  return res.data;
};

// ========== System Status ==========

export const getSystemStatus = async (): Promise<SystemStatus> => {
  const res = await api.get('/api/system/status');
  return res.data;
};

export const getDashboardGraphStats = async (): Promise<DashboardGraphStats> => {
  const res = await api.get('/api/system/graph-stats');
  return res.data;
};

// ========== Settings ==========

export const getSettings = async (): Promise<SettingsResponse> => {
  const res = await api.get('/api/settings');
  return res.data;
};

export const updateSettings = async (data: Partial<SettingsUpdate>): Promise<SettingsResponse> => {
  const res = await api.put('/api/settings', data);
  return res.data;
};

export const uploadLogo = async (file: File): Promise<{ logo_url: string }> => {
  const formData = new FormData();
  formData.append('file', file);
  const res = await api.post('/api/settings/logo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

// ========== Chat (SSE) ==========

export interface ChatSSECallbacks {
  onContext: (references: ChatReference[]) => void;
  onToken: (token: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export const sendChatMessage = async (
  request: {
    query: string;
    collection_name?: string;
    conversation_history: { role: string; content: string }[];
    use_hybrid?: boolean;
    top_k?: number;
  },
  callbacks: ChatSSECallbacks,
  signal?: AbortSignal
): Promise<void> => {
  try {
    const response = await fetch('http://localhost:8000/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });

    if (!response.ok) {
      callbacks.onError(`请求失败: ${response.status}`);
      return;
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7);
        } else if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6);

          if (currentEvent === 'context') {
            try {
              const refs = JSON.parse(data) as ChatReference[];
              callbacks.onContext(refs);
            } catch {
              // ignore parse error
            }
          } else if (currentEvent === 'token') {
            try {
              callbacks.onToken(JSON.parse(data));
            } catch {
              callbacks.onToken(data);
            }
          } else if (currentEvent === 'done') {
            callbacks.onDone();
            return;
          } else if (currentEvent === 'error') {
            try {
              const parsed = JSON.parse(data);
              callbacks.onError(parsed.error || data);
            } catch {
              callbacks.onError(data);
            }
            return;
          }
        } else if (trimmed === '') {
          // Empty line = end of SSE event, reset event type
          currentEvent = '';
        }
      }
    }

    // Stream ended without explicit done event
    callbacks.onDone();
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      // User aborted, just call done
      callbacks.onDone();
      return;
    }
    callbacks.onError(err instanceof Error ? err.message : '未知错误');
  }
};

// ========== Upload Tasks ==========

export const startUpload = async (collectionId: string, files: File[]): Promise<{ task_id: string }> => {
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  const res = await api.post(`/api/collections/${collectionId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
};

export const getUploadTasks = async (): Promise<UploadTask[]> => {
  const res = await api.get('/api/upload-tasks');
  return res.data;
};

export const cancelUploadTask = async (taskId: string): Promise<void> => {
  await api.post(`/api/upload-tasks/${taskId}/cancel`);
};

// ========== Vectorize Tasks ==========

export const startVectorize = async (collectionId: string, documentIds: string[]): Promise<{ task_id: string }> => {
  const res = await api.post(`/api/collections/${collectionId}/vectorize`, {
    document_ids: documentIds,
  });
  return res.data;
};

export const getVectorizeTasks = async (): Promise<VectorizeTask[]> => {
  const res = await api.get('/api/vectorize-tasks');
  return res.data;
};

export const cancelVectorizeTask = async (taskId: string): Promise<void> => {
  await api.post(`/api/vectorize-tasks/${taskId}/cancel`);
};

// ========== Extraction Tasks ==========

export const startExtraction = async (params: { collection_id: string; document_ids?: string[] }): Promise<ExtractionTask> => {
  const res = await api.post('/api/knowledge-graph/extract', {
    collection_id: params.collection_id,
    document_ids: params.document_ids || [],
  });
  return res.data;
};

export const getExtractionTasks = async (): Promise<ExtractionTask[]> => {
  const res = await api.get('/api/knowledge-graph/tasks');
  return res.data;
};

export const getExtractionTask = async (taskId: string): Promise<ExtractionTask> => {
  const res = await api.get(`/api/knowledge-graph/tasks/${taskId}`);
  return res.data;
};

export const cancelExtraction = async (taskId: string): Promise<{ status: string; message: string }> => {
  const res = await api.post(`/api/knowledge-graph/tasks/${taskId}/cancel`);
  return res.data;
};

export const getAllKnowledgeGraphs = async (): Promise<KnowledgeGraphData> => {
  const res = await api.get('/api/knowledge-graph/all');
  return res.data;
};

export const getExtractionStatus = async (collectionId: string): Promise<{
  collection_id: string;
  total_documents: number;
  extracted_documents: number;
  unextracted_documents: number;
}> => {
  const res = await api.get(`/api/knowledge-graph/${collectionId}/extraction-status`);
  return res.data;
};

// ========== Integrations ==========

export const getIntegrations = async (): Promise<IntegrationService[]> => {
  const res = await api.get('/api/integrations');
  return res.data;
};

export const createIntegration = async (data: IntegrationServiceCreate): Promise<IntegrationService> => {
  const res = await api.post('/api/integrations', data);
  return res.data;
};

export const updateIntegration = async (id: string, data: Partial<IntegrationServiceCreate & { enabled: boolean }>): Promise<IntegrationService> => {
  const res = await api.put(`/api/integrations/${id}`, data);
  return res.data;
};

export const deleteIntegration = async (id: string): Promise<void> => {
  await api.delete(`/api/integrations/${id}`);
};

export const getIntegrationConfig = async (id: string): Promise<IntegrationConfig> => {
  const res = await api.get(`/api/integrations/${id}/config`);
  return res.data;
};

// ========== Directory Sync ==========

export const getSyncFolders = async (collectionId: string): Promise<SyncFolder[]> => {
  const res = await api.get(`/api/collections/${collectionId}/sync-folders`);
  return res.data;
};

export const createSyncFolder = async (collectionId: string, config: SyncFolderCreate): Promise<SyncFolder> => {
  const res = await api.post(`/api/collections/${collectionId}/sync-folders`, config);
  return res.data;
};

export const updateSyncFolder = async (syncId: string, config: SyncFolderUpdate): Promise<SyncFolder> => {
  const res = await api.put(`/api/sync-folders/${syncId}`, config);
  return res.data;
};

export const deleteSyncFolder = async (syncId: string): Promise<void> => {
  await api.delete(`/api/sync-folders/${syncId}`);
};

export const triggerSync = async (syncId: string): Promise<void> => {
  await api.post(`/api/sync-folders/${syncId}/trigger`);
};

export default api;
