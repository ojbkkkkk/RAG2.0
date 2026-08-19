import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Database, FileText, Layers, Trash2, Sparkles, Zap } from 'lucide-react';
import { getCollections, createCollection, deleteCollection, startVectorize, getDocuments } from '../api/client';
import type { Collection } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { CardSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useExtraction } from '../components/ExtractionContext';

type ChunkPreset = 'precise' | 'balanced' | 'long';

const CHUNK_PRESETS: Record<ChunkPreset, { label: string; chunk_size: number; chunk_overlap: number; desc: string; scene: string }> = {
  precise: { label: '精准模式', chunk_size: 256, chunk_overlap: 30, desc: '较小分块提高检索精度', scene: '适合FAQ、技术文档等精准问答场景' },
  balanced: { label: '均衡模式', chunk_size: 512, chunk_overlap: 50, desc: '平衡精度与上下文', scene: '适合通用文档、报告、论文等' },
  long: { label: '长上下文', chunk_size: 1024, chunk_overlap: 100, desc: '较大分块保留更多上下文', scene: '适合代码、法律文本等需要保留完整段落的场景' },
};

export default function Collections() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Collection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [chunkPreset, setChunkPreset] = useState<ChunkPreset>('balanced');
  const [chunkSize, setChunkSize] = useState(512);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [customMode, setCustomMode] = useState(false);
  const [extractTarget, setExtractTarget] = useState<Collection | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [vectorizeTarget, setVectorizeTarget] = useState<Collection | null>(null);
  const [vectorizing, setVectorizing] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { startTask } = useExtraction();

  const fetchCollections = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await getCollections();
      setCollections(data);
    } catch {
      if (!silent) addToast('error', '获取知识库列表失败');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchCollections();
    // Poll every 30 seconds
    pollingRef.current = setInterval(() => fetchCollections(true), 30000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchCollections]);

  const handlePresetChange = (preset: ChunkPreset) => {
    setChunkPreset(preset);
    setCustomMode(false);
    const config = CHUNK_PRESETS[preset];
    setChunkSize(config.chunk_size);
    setChunkOverlap(config.chunk_overlap);
  };

  const handleChunkSizeChange = (value: number) => {
    const clamped = Math.min(2048, Math.max(128, value));
    setChunkSize(clamped);
    // Auto-clamp overlap to <= chunk_size/2
    if (chunkOverlap > Math.floor(clamped / 2)) {
      setChunkOverlap(Math.floor(clamped / 2));
    }
    setCustomMode(true);
  };

  const handleChunkOverlapChange = (value: number) => {
    const maxOverlap = Math.floor(chunkSize / 2);
    const clamped = Math.min(maxOverlap, Math.max(0, value));
    setChunkOverlap(clamped);
    setCustomMode(true);
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await createCollection({
        name: form.name,
        description: form.description,
        chunk_size: chunkSize,
        chunk_overlap: chunkOverlap,
      });
      setShowCreate(false);
      setForm({ name: '', description: '' });
      setChunkPreset('balanced');
      setChunkSize(512);
      setChunkOverlap(50);
      setCustomMode(false);
      addToast('success', '知识库创建成功');
      fetchCollections();
    } catch {
      addToast('error', '创建知识库失败');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deleteCollection(deleteTarget.id);
      setDeleteTarget(null);
      addToast('success', '知识库已删除');
      fetchCollections();
    } catch {
      addToast('error', '删除知识库失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleVectorize = async () => {
    if (!vectorizeTarget) return;
    try {
      setVectorizing(true);
      // 获取知识库下所有文档，过滤出未向量化的
      const docs = await getDocuments(vectorizeTarget.id);
      const unvectorized = docs.filter((d: any) => !d.vectorized);
      if (unvectorized.length === 0) {
        addToast('info', '所有文档均已向量化，无需重复操作');
        setVectorizeTarget(null);
        return;
      }
      await startVectorize(vectorizeTarget.id, unvectorized.map((d: any) => d.id));
      setVectorizeTarget(null);
      addToast('success', '向量化任务已启动');
    } catch {
      addToast('error', '启动向量化失败');
    } finally {
      setVectorizing(false);
    }
  };

  const handleExtract = async () => {
    if (!extractTarget) return;
    try {
      setExtracting(true);
      await startTask(extractTarget.id);
      setExtractTarget(null);
      addToast('success', '实体提取已启动');
    } catch {
      addToast('error', '启动实体提取失败');
    } finally {
      setExtracting(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const currentPresetDesc = customMode
    ? '自定义分块参数'
    : CHUNK_PRESETS[chunkPreset].desc;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">知识库</h1>
          <p className="text-sm text-gray-400 mt-1">管理和组织你的文档知识库</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors btn-hover-scale"
        >
          <Plus size={16} />
          创建知识库
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          variant="collection"
          title="暂无知识库"
          description="创建你的第一个知识库，开始管理文档"
          action={
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 btn-hover-scale"
            >
              创建知识库
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {collections.map((col, idx) => (
            <div
              key={col.id}
              className="animate-stagger bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5 hover:bg-white/10 hover:border-white/20 transition-all cursor-pointer group shadow-lg shadow-black/20"
              style={{ animationDelay: `${idx * 60}ms` }}
              onClick={() => navigate(`/collections/${col.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                  <Database className="text-indigo-400" size={20} />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setVectorizeTarget(col);
                    }}
                    className="p-1.5 rounded-md hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 transition-all"
                    title="向量化"
                  >
                    <Zap size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExtractTarget(col);
                    }}
                    className="p-1.5 rounded-md hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400 transition-all"
                    title="深入学习"
                  >
                    <Sparkles size={16} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(col);
                    }}
                    className="p-1.5 rounded-md hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
                    title="彻底删除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-white mb-1 truncate">{col.name}</h3>
              <p className="text-sm text-gray-400 mb-4 line-clamp-2 min-h-[2.5rem]">
                {col.description || '暂无描述'}
              </p>
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <FileText size={12} />
                  {col.document_count} 文档
                </span>
                <span className="flex items-center gap-1">
                  <Layers size={12} />
                  {col.chunk_count} 分块
                </span>
                <span className="ml-auto">{formatDate(col.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="创建知识库">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">名称</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="输入知识库名称"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">描述</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="输入知识库描述（可选）"
              rows={3}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30 resize-none"
            />
          </div>

          {/* 分块设置 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">分块设置</label>
            <div className="bg-white/5 rounded-lg p-4 space-y-3">
              {/* 预设按钮组 */}
              <div className="flex gap-2">
                {(Object.keys(CHUNK_PRESETS) as ChunkPreset[]).map((key) => {
                  const preset = CHUNK_PRESETS[key];
                  const isActive = !customMode && chunkPreset === key;
                  return (
                    <div key={key} className="flex-1 flex flex-col items-center">
                      <button
                        onClick={() => handlePresetChange(key)}
                        className={`w-full px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                          isActive
                            ? 'bg-gradient-to-r from-indigo-500 to-cyan-600 text-white border-indigo-500 shadow-sm'
                            : 'bg-white/5 text-gray-400 border-white/10 hover:border-indigo-400/50 hover:text-indigo-400'
                        }`}
                      >
                        {preset.label}
                      </button>
                      <span className="text-xs text-gray-500 mt-1 text-center leading-tight">{preset.scene}</span>
                    </div>
                  );
                })}
              </div>

              {/* 参数输入 */}
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">分块大小</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={chunkSize}
                      onChange={(e) => handleChunkSizeChange(Number(e.target.value))}
                      min={128}
                      max={2048}
                      step={64}
                      className="w-24 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-md text-sm text-center text-white focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
                    />
                    <span className="text-xs text-gray-500">字符</span>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">重叠</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      value={chunkOverlap}
                      onChange={(e) => handleChunkOverlapChange(Number(e.target.value))}
                      min={0}
                      max={Math.floor(chunkSize / 2)}
                      step={10}
                      className="w-24 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-md text-sm text-center text-white focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
                    />
                    <span className="text-xs text-gray-500">字符</span>
                  </div>
                </div>
              </div>

              {/* 提示信息 */}
              <p className="text-xs text-gray-500">
                {currentPresetDesc}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!form.name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-lg hover:from-indigo-400 hover:to-cyan-500 disabled:opacity-50 btn-hover-scale"
            >
              创建
            </button>
          </div>
        </div>
      </Modal>

      {/* Vectorize Confirm */}
      <ConfirmDialog
        isOpen={!!vectorizeTarget}
        onClose={() => setVectorizeTarget(null)}
        onConfirm={handleVectorize}
        title="向量化"
        message={`确定要对知识库「${vectorizeTarget?.name}」的所有文档进行向量化吗？已向量化的文档将自动跳过。`}
        confirmLabel="确认向量化"
        loadingLabel="处理中..."
        loading={vectorizing}
      />

      {/* Extract Confirm */}
      <ConfirmDialog
        isOpen={!!extractTarget}
        onClose={() => setExtractTarget(null)}
        onConfirm={handleExtract}
        title="深入学习"
        message={`确定要对知识库「${extractTarget?.name}」的所有文档进行深入学习吗？已提取过图谱的文档将自动跳过。`}
        confirmLabel="确认学习"
        loadingLabel="学习中..."
        loading={extracting}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="彻底删除"
        message={`确定要彻底删除知识库「${deleteTarget?.name}」吗？此操作将删除该知识库下所有文档的向量数据、图谱数据及文档本体，不可撤销。`}
        loading={deleting}
      />
    </div>
  );
}
