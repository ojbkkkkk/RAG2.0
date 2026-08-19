import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Trash2, Upload, Settings2, Sparkles, Zap, MoreVertical, Database, GitBranch, FolderSync } from 'lucide-react';
import { getCollection, getDocuments, deleteDocument, batchDeleteDocuments, getSupportedFormats, deleteDocumentVectors, deleteDocumentGraph, getSyncFolders, createSyncFolder, updateSyncFolder, deleteSyncFolder, triggerSync } from '../api/client';
import type { Collection, Document, SyncFolder } from '../types';
import FileUpload from '../components/FileUpload';
import ConfirmDialog from '../components/ConfirmDialog';
import { TableSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';
import { useTaskContext } from '../components/ExtractionContext';

export default function CollectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const {
    startUploadTask,
    startVectorizeTask,
    startExtractionTask,
    uploadTasks,
    vectorizeTasks,
    hasActiveTasks,
  } = useTaskContext();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);
  const [supportedFormats, setSupportedFormats] = useState<string[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'deleteVectors' | 'deleteGraph'; ids: string[] } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncFolders, setSyncFolders] = useState<SyncFolder[]>([]);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncForm, setSyncForm] = useState({
    folder_path: '',
    poll_interval: 30,
    auto_vectorize: 0,
    auto_extract: 0,
    ignore_patterns: '',
  });
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!id) return;
    try {
      if (!silent) setLoading(true);
      const [col, docs] = await Promise.all([getCollection(id), getDocuments(id)]);
      setCollection(col);
      setDocuments(docs);
    } catch {
      if (!silent) addToast('error', '获取知识库详情失败');
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => {
    fetchData();
    getSupportedFormats().then(setSupportedFormats).catch(() => {});
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchData]);

  // 点击菜单外部时关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    if (menuOpenId) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

  // 当有活跃任务时轮询刷新文档列表
  const prevHasActiveTasks = useRef(hasActiveTasks);

  useEffect(() => {
    if (hasActiveTasks) {
      if (!pollingRef.current) {
        pollingRef.current = setInterval(() => fetchData(true), 3000);
      }
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        // 任务完成后再刷新一次获取最新状态
        if (prevHasActiveTasks.current) {
          fetchData(true);
        }
      }
    }
    prevHasActiveTasks.current = hasActiveTasks;
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [hasActiveTasks, fetchData]);

  const handleUpload = async (files: File[]) => {
    if (!id) return;
    try {
      await startUploadTask(id, files);
      addToast('success', '文档上传任务已创建');
      setShowUpload(false);
      fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '文档上传失败';
      addToast('error', message);
    }
  };

  const handleVectorize = async () => {
    if (!id || selectedIds.size === 0) return;
    try {
      await startVectorizeTask(id, [...selectedIds]);
      setSelectedIds(new Set());
      addToast('success', '向量化任务已启动');
    } catch {
      addToast('error', '启动向量化失败');
    }
  };

  const handleExtract = async () => {
    if (!id || selectedIds.size === 0) return;
    try {
      await startExtractionTask(id, [...selectedIds]);
      setSelectedIds(new Set());
      addToast('success', '深入学习任务已启动');
    } catch {
      addToast('error', '启动深入学习失败');
    }
  };

  const handleDeleteDoc = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      // 彻底删除：向量 → 图谱 → 文档
      await deleteDocumentVectors([deleteTarget.id]);
      await deleteDocumentGraph([deleteTarget.id]);
      await deleteDocument(deleteTarget.id);
      setDeleteTarget(null);
      addToast('success', '文档已彻底删除');
      fetchData();
    } catch {
      addToast('error', '彻底删除文档失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleBatchDelete = async () => {
    try {
      setBatchDeleting(true);
      const ids = [...selectedIds];
      // 批量彻底删除：向量 → 图谱 → 文档
      await deleteDocumentVectors(ids);
      await deleteDocumentGraph(ids);
      const result = await batchDeleteDocuments(ids);
      setSelectedIds(new Set());
      setShowBatchConfirm(false);
      if (result.failed > 0) {
        addToast('warning', `已彻底删除 ${result.deleted} 个文档，${result.failed} 个失败`);
      } else {
        addToast('success', `已彻底删除 ${result.deleted} 个文档`);
      }
      fetchData();
    } catch {
      addToast('error', '批量彻底删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    try {
      setActionLoading(true);
      if (confirmAction.type === 'deleteVectors') {
        const res = await deleteDocumentVectors(confirmAction.ids);
        addToast('success', `已删除 ${res.deleted_count} 个文档的向量化数据`);
      } else {
        const res = await deleteDocumentGraph(confirmAction.ids);
        addToast('success', `已删除 ${res.deleted_nodes} 个节点、${res.deleted_edges} 条边`);
      }
      setConfirmAction(null);
      setSelectedIds(new Set());
      fetchData();
    } catch {
      addToast('error', confirmAction.type === 'deleteVectors' ? '删除向量化数据失败' : '删除图谱数据失败');
    } finally {
      setActionLoading(false);
    }
  };

  const toggleSelect = (docId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const loadSyncFolders = useCallback(async () => {
    if (!id) return;
    setSyncLoading(true);
    try {
      const folders = await getSyncFolders(id);
      setSyncFolders(folders);
    } catch { }
    setSyncLoading(false);
  }, [id]);

  const handleAddSync = async () => {
    if (!id || !syncForm.folder_path.trim()) return;
    try {
      const ignorePatterns = syncForm.ignore_patterns
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      await createSyncFolder(id, {
        folder_path: syncForm.folder_path.trim(),
        poll_interval: syncForm.poll_interval,
        auto_vectorize: syncForm.auto_vectorize,
        auto_extract: syncForm.auto_extract,
        ignore_patterns: ignorePatterns,
      });
      addToast('success', '同步目录添加成功');
      setSyncForm({ folder_path: '', poll_interval: 30, auto_vectorize: 0, auto_extract: 0, ignore_patterns: '' });
      loadSyncFolders();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      addToast('error', detail || '添加失败');
    }
  };

  const toggleSyncActive = async (folder: SyncFolder) => {
    try {
      await updateSyncFolder(folder.id, { active: folder.active ? 0 : 1 });
      loadSyncFolders();
    } catch { }
  };

  const handleTriggerSync = async (syncId: string) => {
    try {
      await triggerSync(syncId);
      addToast('success', '同步已触发');
    } catch { }
  };

  const handleDeleteSync = async (syncId: string) => {
    try {
      await deleteSyncFolder(syncId);
      addToast('success', '同步目录已删除');
      loadSyncFolders();
    } catch { }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === documents.length && documents.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(documents.map((d) => d.id)));
    }
  };

  // 判断向量化按钮是否可点击：选中文件中有 vectorized=0 的
  const canVectorize = [...selectedIds].some(docId => {
    const doc = documents.find(d => d.id === docId);
    return doc && doc.vectorized === 0;
  });

  // 判断深入学习按钮是否可点击：选中文件中有 graph_extracted=0 的
  const canExtract = [...selectedIds].some(docId => {
    const doc = documents.find(d => d.id === docId);
    return doc && doc.graph_extracted === 0;
  });

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) return <TableSkeleton rows={4} />;
  if (!collection) return <div className="text-gray-500">知识库不存在</div>;

  const allSelectableSelected = documents.length > 0 && selectedIds.size === documents.length;

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate('/collections')}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        返回知识库列表
      </button>

      {/* Collection Info */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{collection.name}</h1>
            <p className="text-sm text-gray-400">{collection.description || '暂无描述'}</p>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-400">{collection.document_count}</p>
              <p className="text-xs text-gray-500">文档</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-indigo-400">{collection.chunk_count}</p>
              <p className="text-xs text-gray-500">分块</p>
            </div>
          </div>
        </div>
        {/* 分块配置 */}
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Settings2 size={14} />
            <span className="font-medium">分块配置：</span>
            <span className="text-gray-300">大小 {collection.chunk_size} 字符</span>
            <span className="text-gray-600">|</span>
            <span className="text-gray-300">重叠 {collection.chunk_overlap} 字符</span>
            {collection.chunk_size <= 384 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-indigo-500/20 text-indigo-400 rounded">精准模式</span>
            )}
            {collection.chunk_size > 384 && collection.chunk_size <= 768 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-500/20 text-green-400 rounded">均衡模式</span>
            )}
            {collection.chunk_size > 768 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-purple-500/20 text-purple-400 rounded">长上下文</span>
            )}
          </div>
        </div>
      </div>

      {/* Documents Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">文档列表</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowSyncModal(true); loadSyncFolders(); }}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 text-white text-sm font-medium rounded-lg hover:bg-white/20 transition-colors border border-white/20"
          >
            <FolderSync size={16} />
            同步目录
          </button>
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors btn-hover-scale"
          >
            <Upload size={16} />
            上传文档
          </button>
        </div>
      </div>

      {/* Upload Area */}
      {showUpload && (
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6">
          <FileUpload
            onUpload={handleUpload}
            supportedFormats={supportedFormats}
          />
        </div>
      )}

      {/* Document Table */}
      {documents.length === 0 ? (
        <EmptyState
          variant="document"
          title="暂无文档"
          description="上传文档到这个知识库"
        />
      ) : (
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl">
          {/* Batch Action Bar */}
          {selectedIds.size > 0 && (
            <div className="flex items-center justify-between px-5 py-3 bg-indigo-500/10 border-b border-indigo-500/20">
              <span className="text-sm text-indigo-400 font-medium">
                已选择 {selectedIds.size} 个文档
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  取消选择
                </button>
                <button
                  onClick={handleVectorize}
                  disabled={!canVectorize}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-blue-500 to-cyan-600 rounded-lg hover:from-blue-400 hover:to-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Zap size={14} />
                  向量化
                </button>
                <button
                  onClick={handleExtract}
                  disabled={!canExtract}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Sparkles size={14} />
                  深入学习
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'deleteVectors', ids: [...selectedIds].filter(did => documents.find(d => d.id === did)?.vectorized === 1) })}
                  disabled={![...selectedIds].some(did => documents.find(d => d.id === did)?.vectorized === 1)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-600 rounded-lg hover:from-amber-400 hover:to-orange-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Database size={14} />
                  批量删除向量化
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'deleteGraph', ids: [...selectedIds].filter(did => documents.find(d => d.id === did)?.graph_extracted === 1) })}
                  disabled={![...selectedIds].some(did => documents.find(d => d.id === did)?.graph_extracted === 1)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-rose-500 to-pink-600 rounded-lg hover:from-rose-400 hover:to-pink-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <GitBranch size={14} />
                  批量删除图谱数据
                </button>
                <button
                  onClick={() => setShowBatchConfirm(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-gradient-to-r from-red-500 to-rose-600 rounded-lg hover:from-red-400 hover:to-rose-500 transition-colors"
                >
                  <Trash2 size={14} />
                  批量彻底删除
                </button>
              </div>
            </div>
          )}
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5 bg-white/5">
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelectableSelected}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-600 text-indigo-500 focus:ring-indigo-400 bg-white/5 cursor-pointer"
                  />
                </th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">文件名</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">类型</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">大小</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">分块数</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">状态</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">向量化</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">深入学习</th>
                <th className="text-left text-xs font-medium text-gray-400 px-5 py-3">上传时间</th>
                <th className="text-right text-xs font-medium text-gray-400 px-5 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc, idx) => {
                return (
                  <tr
                    key={doc.id}
                    className={`border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors animate-stagger ${
                      selectedIds.has(doc.id) ? 'bg-indigo-500/10' : ''
                    } ${menuOpenId === doc.id ? 'relative z-50' : ''}`}
                    style={{ animationDelay: `${idx * 40}ms` }}
                    onClick={() => navigate(`/documents/${doc.id}`)}
                  >
                    <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelect(doc.id)}

                        className="h-4 w-4 rounded border-gray-600 text-indigo-500 focus:ring-indigo-400 bg-white/5 cursor-pointer"
                      />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <FileText size={16} className="text-gray-400 flex-shrink-0" />
                        <span className="text-sm text-white truncate max-w-[200px]">
                          {doc.filename}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded font-mono">
                        {doc.file_type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">{formatSize(doc.file_size)}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">{doc.chunk_count}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded ${
                          doc.status === 'completed'
                            ? 'bg-green-500/20 text-green-400'
                            : doc.status === 'processing'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : doc.status === 'failed'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-white/10 text-gray-400'
                        }`}
                      >
                        {doc.status === 'completed'
                          ? '已完成'
                          : doc.status === 'processing'
                            ? '处理中'
                            : doc.status === 'failed'
                              ? '失败'
                              : doc.status}
                      </span>
                      {doc.status === 'failed' && doc.error_message && (
                        <p className="text-xs text-red-400 mt-0.5 max-w-[160px] truncate" title={doc.error_message}>
                          {doc.error_message}
                        </p>
                      )}
                    </td>
                    {/* 向量化状态 */}
                    <td className="px-5 py-3.5">
                      {doc.vectorized === 1 ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                          已向量化
                        </span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-white/10 text-gray-400">
                          未向量化
                        </span>
                      )}
                    </td>
                    {/* 深入学习状态 */}
                    <td className="px-5 py-3.5">
                      {doc.graph_extracted === 1 ? (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-green-500/20 text-green-400">
                          已学习
                        </span>
                      ) : (
                        <span className="text-xs font-medium px-2 py-0.5 rounded bg-white/10 text-gray-400">
                          未学习
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{formatDate(doc.created_at)}</td>
                    <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="relative" ref={menuOpenId === doc.id ? menuRef : undefined}>
                        <button
                          onClick={() => setMenuOpenId(menuOpenId === doc.id ? null : doc.id)}
                          className="p-1.5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        >
                          <MoreVertical size={16} />
                        </button>
                        {menuOpenId === doc.id && (
                          <div className="absolute right-0 top-8 z-50 w-44 bg-slate-800/95 backdrop-blur border border-white/10 rounded-lg shadow-xl py-1">
                            <button
                              onClick={() => {
                                setMenuOpenId(null);
                                setConfirmAction({ type: 'deleteVectors', ids: [doc.id] });
                              }}
                              disabled={doc.vectorized !== 1}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                            >
                              <Database size={14} className={doc.vectorized === 1 ? 'text-amber-400' : ''} />
                              删除向量化
                            </button>
                            <button
                              onClick={() => {
                                setMenuOpenId(null);
                                setConfirmAction({ type: 'deleteGraph', ids: [doc.id] });
                              }}
                              disabled={doc.graph_extracted !== 1}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                            >
                              <GitBranch size={14} className={doc.graph_extracted === 1 ? 'text-rose-400' : ''} />
                              删除图谱数据
                            </button>
                            <div className="my-1 border-t border-white/10" />
                            <button
                              onClick={() => {
                                setMenuOpenId(null);
                                setDeleteTarget(doc);
                              }}
                              className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-red-400 hover:bg-red-500/10 transition-colors"
                            >
                              <Trash2 size={14} />
                              彻底删除
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete Confirm */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteDoc}
        title="彻底删除"
        message={`确定要彻底删除文档「${deleteTarget?.filename}」吗？将同时删除该文档的所有向量数据和图谱数据，此操作不可撤销。`}
        loading={deleting}
      />

      {/* Batch Delete Confirm */}
      <ConfirmDialog
        isOpen={showBatchConfirm}
        onClose={() => setShowBatchConfirm(false)}
        onConfirm={handleBatchDelete}
        title="批量彻底删除"
        message={`确定要彻底删除选中的 ${selectedIds.size} 个文档吗？将同时删除这些文档的所有向量数据和图谱数据，此操作不可撤销。`}
        loading={batchDeleting}
      />

      {/* Delete Vectors / Delete Graph Confirm */}
      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
        title={confirmAction?.type === 'deleteVectors' ? '删除向量化数据' : '删除图谱数据'}
        message={
          confirmAction?.type === 'deleteVectors'
            ? `确定要删除 ${confirmAction.ids.length} 个文档的向量化数据吗？向量将全部清除，此操作不可撤销。`
            : `确定要删除 ${confirmAction?.ids.length} 个文档的图谱数据吗？相关节点和边将全部清除，此操作不可撤销。`
        }
        confirmLabel={confirmAction?.type === 'deleteVectors' ? '删除向量化' : '删除图谱数据'}
        loading={actionLoading}
      />

      {/* Sync Folders Modal */}
      {showSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSyncModal(false)} />
          <div className="relative bg-gray-900 border border-white/10 rounded-2xl w-[600px] max-h-[80vh] overflow-y-auto p-6">
            <h3 className="text-lg font-semibold text-white mb-4">目录同步管理</h3>

            {/* 已配置的同步目录列表 */}
            <div className="space-y-3 mb-6">
              {syncLoading ? (
                <p className="text-gray-500 text-sm text-center py-4">加载中...</p>
              ) : syncFolders.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">暂未配置同步目录</p>
              ) : (
                syncFolders.map(folder => (
                  <div key={folder.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${folder.active ? 'bg-green-400' : 'bg-gray-500'}`} />
                        <span className="text-white text-sm font-medium truncate max-w-[300px]" title={folder.folder_path}>{folder.folder_path}</span>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <button
                          onClick={() => toggleSyncActive(folder)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                            folder.active
                              ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          }`}
                        >
                          {folder.active ? '暂停' : '启用'}
                        </button>
                        <button
                          onClick={() => handleTriggerSync(folder.id)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 transition-colors"
                        >
                          同步
                        </button>
                        <button
                          onClick={() => handleDeleteSync(folder.id)}
                          className="px-2.5 py-1 text-xs font-medium rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                      <span>间隔: {folder.poll_interval}s</span>
                      {folder.auto_vectorize ? <span className="text-purple-400">自动向量化</span> : null}
                      {folder.auto_extract ? <span className="text-green-400">自动深入学习</span> : null}
                      {folder.last_synced_at && <span>上次同步: {new Date(folder.last_synced_at).toLocaleString('zh-CN')}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 添加目录表单 */}
            <div className="border-t border-white/10 pt-4">
              <h4 className="text-sm font-medium text-white mb-3">添加同步目录</h4>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="本地目录绝对路径，如 /Users/xxx/documents"
                  value={syncForm.folder_path}
                  onChange={e => setSyncForm({ ...syncForm, folder_path: e.target.value })}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                />
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">轮询间隔（秒）</label>
                    <input
                      type="number"
                      min={5}
                      value={syncForm.poll_interval}
                      onChange={e => setSyncForm({ ...syncForm, poll_interval: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">忽略模式（逗号分隔）</label>
                    <input
                      type="text"
                      placeholder="*.tmp, .git, node_modules"
                      value={syncForm.ignore_patterns}
                      onChange={e => setSyncForm({ ...syncForm, ignore_patterns: e.target.value })}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncForm.auto_vectorize === 1}
                      onChange={e => setSyncForm({ ...syncForm, auto_vectorize: e.target.checked ? 1 : 0 })}
                      className="rounded border-white/20"
                    />
                    同步后自动向量化
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncForm.auto_extract === 1}
                      onChange={e => setSyncForm({ ...syncForm, auto_extract: e.target.checked ? 1 : 0 })}
                      className="rounded border-white/20"
                    />
                    同步后自动深入学习
                  </label>
                </div>
                <button
                  onClick={handleAddSync}
                  disabled={!syncForm.folder_path.trim()}
                  className="w-full px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  添加同步目录
                </button>
              </div>
            </div>

            {/* 关闭按钮 */}
            <button
              onClick={() => setShowSyncModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors text-lg leading-none"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
