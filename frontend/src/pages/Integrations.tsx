import { useState, useEffect, useCallback } from 'react';
import {
  Plug,
  Plus,
  Trash2,
  Eye,
  Copy,
  Loader2,
  CheckCircle,
  Bot,
  Cpu,
  Zap,
  ScanSearch,
  GitBranch,
  Layers,
  Database,
} from 'lucide-react';
import {
  getIntegrations,
  createIntegration,
  updateIntegration,
  deleteIntegration,
  getIntegrationConfig,
  getCollections,
} from '../api/client';
import type { IntegrationService, IntegrationServiceCreate, IntegrationConfig, Collection } from '../types';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { CardSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';

// ── 常量映射 ──────────────────────────────────────────────

const AGENT_TYPE_MAP: Record<IntegrationService['agent_type'], { label: string; color: string; bg: string; icon: typeof Bot }> = {
  claude_code: { label: 'Claude Code', color: 'text-purple-300', bg: 'bg-purple-500/20 border-purple-500/30', icon: Bot },
  codex: { label: 'Codex', color: 'text-green-300', bg: 'bg-green-500/20 border-green-500/30', icon: Cpu },
  hermes: { label: 'Hermes', color: 'text-blue-300', bg: 'bg-blue-500/20 border-blue-500/30', icon: Zap },
};

const RETRIEVAL_MODE_MAP: Record<IntegrationService['retrieval_mode'], { label: string; color: string; bg: string; icon: typeof ScanSearch }> = {
  vector: { label: '向量检索', color: 'text-cyan-300', bg: 'bg-cyan-500/20 border-cyan-500/30', icon: ScanSearch },
  graph: { label: '图谱检索', color: 'text-orange-300', bg: 'bg-orange-500/20 border-orange-500/30', icon: GitBranch },
  hybrid: { label: '混合检索', color: 'text-pink-300', bg: 'bg-pink-500/20 border-pink-500/30', icon: Layers },
};

export default function Integrations() {
  const { addToast } = useToast();
  const [services, setServices] = useState<IntegrationService[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  // 新建弹窗状态
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<IntegrationServiceCreate>({
    name: '',
    agent_type: 'claude_code',
    retrieval_mode: 'vector',
    collections: [],
  });

  // 对接说明弹窗状态
  const [showConfig, setShowConfig] = useState(false);
  const [configData, setConfigData] = useState<IntegrationConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [copied, setCopied] = useState(false);

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<IntegrationService | null>(null);
  const [deleting, setDeleting] = useState(false);

  // 切换 enabled 状态
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [integrationData, collectionData] = await Promise.all([
        getIntegrations(),
        getCollections(),
      ]);
      setServices(integrationData);
      setCollections(collectionData);
    } catch {
      if (!silent) addToast('error', '获取对接服务列表失败');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── 新建服务 ──────────────────────────────────────────

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    try {
      setCreating(true);
      await createIntegration(createForm);
      setShowCreate(false);
      setCreateForm({ name: '', agent_type: 'claude_code', retrieval_mode: 'vector', collections: [] });
      addToast('success', '对接服务创建成功');
      fetchData();
    } catch {
      addToast('error', '创建对接服务失败');
    } finally {
      setCreating(false);
    }
  };

  // ── 删除服务 ──────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await deleteIntegration(deleteTarget.id);
      setDeleteTarget(null);
      addToast('success', '对接服务已删除');
      fetchData();
    } catch {
      addToast('error', '删除对接服务失败');
    } finally {
      setDeleting(false);
    }
  };

  // ── 切换启用状态 ──────────────────────────────────────

  const handleToggleEnabled = async (service: IntegrationService) => {
    try {
      setTogglingId(service.id);
      await updateIntegration(service.id, { enabled: !service.enabled });
      addToast('success', service.enabled ? '已禁用服务' : '已启用服务');
      fetchData(true);
    } catch {
      addToast('error', '切换服务状态失败');
    } finally {
      setTogglingId(null);
    }
  };

  // ── 查看配置 ──────────────────────────────────────────

  const handleViewConfig = async (service: IntegrationService) => {
    try {
      setLoadingConfig(true);
      setShowConfig(true);
      const config = await getIntegrationConfig(service.id);
      setConfigData(config);
    } catch {
      addToast('error', '获取配置信息失败');
      setShowConfig(false);
    } finally {
      setLoadingConfig(false);
    }
  };

  // ── 复制 JSON ─────────────────────────────────────────

  const handleCopyJson = async () => {
    if (!configData) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(configData.config_json, null, 2));
      setCopied(true);
      addToast('success', '已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('error', '复制失败');
    }
  };

  // ── 知识库多选 ────────────────────────────────────────

  const handleCollectionToggle = (colName: string) => {
    setCreateForm((prev) => {
      const exists = prev.collections.includes(colName);
      return {
        ...prev,
        collections: exists
          ? prev.collections.filter((c) => c !== colName)
          : [...prev.collections, colName],
      };
    });
  };

  const handleSelectAllCollections = () => {
    if (createForm.collections.length === collections.length) {
      setCreateForm((prev) => ({ ...prev, collections: [] }));
    } else {
      setCreateForm((prev) => ({ ...prev, collections: collections.map((c) => c.name) }));
    }
  };

  // ── 渲染 ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">对接配置</h1>
          <p className="text-sm text-gray-400 mt-1">管理知识库与 AI Agent 的 MCP 对接服务</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors btn-hover-scale"
        >
          <Plus size={16} />
          新建服务
        </button>
      </div>

      {/* Service List */}
      {services.length === 0 ? (
        <EmptyState
          variant="collection"
          title="暂无对接服务"
          description="创建一个对接服务，将知识库连接到 AI Agent"
          action={
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 btn-hover-scale"
            >
              新建服务
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {services.map((service, idx) => {
            const agentInfo = AGENT_TYPE_MAP[service.agent_type];
            const retrievalInfo = RETRIEVAL_MODE_MAP[service.retrieval_mode];
            const AgentIcon = agentInfo.icon;
            const RetrievalIcon = retrievalInfo.icon;
            const isToggling = togglingId === service.id;

            return (
              <div
                key={service.id}
                className="animate-stagger bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5 hover:bg-white/10 hover:border-white/20 transition-all shadow-lg shadow-black/20"
                style={{ animationDelay: `${idx * 60}ms` }}
              >
                {/* Card Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                    <Plug className="text-indigo-400" size={20} />
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Toggle switch */}
                    <button
                      onClick={() => handleToggleEnabled(service)}
                      disabled={isToggling}
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        service.enabled ? 'bg-indigo-500' : 'bg-white/20'
                      } ${isToggling ? 'opacity-50' : ''}`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          service.enabled ? 'left-5' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Service Name */}
                <h3 className="font-semibold text-white mb-2 truncate">{service.name}</h3>

                {/* Badges */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${agentInfo.bg}`}>
                    <AgentIcon size={12} className={agentInfo.color} />
                    <span className={agentInfo.color}>{agentInfo.label}</span>
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${retrievalInfo.bg}`}>
                    <RetrievalIcon size={12} className={retrievalInfo.color} />
                    <span className={retrievalInfo.color}>{retrievalInfo.label}</span>
                  </span>
                </div>

                {/* Associated Collections */}
                {service.collections.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-3">
                    <Database size={12} className="text-gray-500 flex-shrink-0" />
                    {service.collections.slice(0, 3).map((colName) => (
                      <span
                        key={colName}
                        className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-xs text-gray-400"
                      >
                        {colName}
                      </span>
                    ))}
                    {service.collections.length > 3 && (
                      <span className="text-xs text-gray-500">+{service.collections.length - 3}</span>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                  <button
                    onClick={() => handleViewConfig(service)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 transition-colors"
                  >
                    <Eye size={12} />
                    查看配置
                  </button>
                  <button
                    onClick={() => setDeleteTarget(service)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 新建服务弹窗 ────────────────────────────────── */}
      <Modal
        isOpen={showCreate}
        onClose={() => {
          if (!creating) {
            setShowCreate(false);
            setCreateForm({ name: '', agent_type: 'claude_code', retrieval_mode: 'vector', collections: [] });
          }
        }}
        title="新建对接服务"
      >
        <div className="space-y-4">
          {/* 服务名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">服务名称</label>
            <input
              type="text"
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              placeholder="输入服务名称"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
              autoFocus
            />
          </div>

          {/* Agent 类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Agent 类型</label>
            <div className="flex gap-2">
              {(Object.entries(AGENT_TYPE_MAP) as [IntegrationService['agent_type'], typeof AGENT_TYPE_MAP['claude_code']][]).map(
                ([key, info]) => {
                  const Icon = info.icon;
                  const isActive = createForm.agent_type === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setCreateForm((f) => ({ ...f, agent_type: key }))}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-indigo-500 to-cyan-600 text-white border-indigo-500 shadow-sm'
                          : 'bg-white/5 text-gray-400 border-white/10 hover:border-indigo-400/50 hover:text-indigo-400'
                      }`}
                    >
                      <Icon size={14} />
                      {info.label}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* 检索方式 */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">检索方式</label>
            <div className="flex gap-2">
              {(Object.entries(RETRIEVAL_MODE_MAP) as [IntegrationService['retrieval_mode'], typeof RETRIEVAL_MODE_MAP['vector']][]).map(
                ([key, info]) => {
                  const Icon = info.icon;
                  const isActive = createForm.retrieval_mode === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setCreateForm((f) => ({ ...f, retrieval_mode: key }))}
                      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-indigo-500 to-cyan-600 text-white border-indigo-500 shadow-sm'
                          : 'bg-white/5 text-gray-400 border-white/10 hover:border-indigo-400/50 hover:text-indigo-400'
                      }`}
                    >
                      <Icon size={14} />
                      {info.label}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* 知识库范围 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">知识库范围</label>
              {collections.length > 0 && (
                <button
                  onClick={handleSelectAllCollections}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  {createForm.collections.length === collections.length ? '取消全选' : '全部知识库'}
                </button>
              )}
            </div>
            <div className="bg-white/5 border border-white/10 rounded-lg max-h-40 overflow-y-auto">
              {collections.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">暂无知识库</div>
              ) : (
                collections.map((col) => {
                  const isSelected = createForm.collections.includes(col.name);
                  return (
                    <button
                      key={col.id}
                      onClick={() => handleCollectionToggle(col.name)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                        isSelected ? 'bg-indigo-500/10 text-indigo-300' : 'text-gray-400 hover:bg-white/5'
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? 'bg-indigo-500 border-indigo-500'
                            : 'border-white/20'
                        }`}
                      >
                        {isSelected && <CheckCircle size={12} className="text-white" />}
                      </span>
                      <Database size={14} className="flex-shrink-0 opacity-60" />
                      <span className="truncate">{col.name}</span>
                    </button>
                  );
                })
              )}
            </div>
            {createForm.collections.length === 0 && (
              <p className="mt-1 text-xs text-gray-500">未选择知识库时将关联所有知识库</p>
            )}
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => {
                setShowCreate(false);
                setCreateForm({ name: '', agent_type: 'claude_code', retrieval_mode: 'vector', collections: [] });
              }}
              disabled={creating}
              className="px-4 py-2 text-sm font-medium text-gray-300 bg-white/10 border border-white/10 rounded-lg hover:bg-white/20 transition-colors disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={!createForm.name.trim() || creating}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-indigo-500 to-cyan-600 rounded-lg hover:from-indigo-400 hover:to-cyan-500 disabled:opacity-50 btn-hover-scale"
            >
              {creating ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── 对接说明弹窗 ────────────────────────────────── */}
      <Modal
        isOpen={showConfig}
        onClose={() => {
          setShowConfig(false);
          setConfigData(null);
          setCopied(false);
        }}
        title="对接配置说明"
      >
        {loadingConfig ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
            <span className="ml-2 text-sm text-gray-400">加载配置中...</span>
          </div>
        ) : configData ? (
          <div className="space-y-4">
            {/* 基本信息行 */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Agent:</span>
                <span className="text-xs font-medium text-purple-300">
                  {AGENT_TYPE_MAP[configData.agent_type as IntegrationService['agent_type']]?.label ?? configData.agent_type}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">检索:</span>
                <span className="text-xs font-medium text-cyan-300">
                  {RETRIEVAL_MODE_MAP[configData.retrieval_mode as IntegrationService['retrieval_mode']]?.label ?? configData.retrieval_mode}
                </span>
              </div>
            </div>

            {/* 配置文件路径 */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">配置文件路径</label>
              <div className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 font-mono">
                {configData.config_path}
              </div>
            </div>

            {/* JSON 配置 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-300">JSON 配置</label>
                <button
                  onClick={handleCopyJson}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 rounded hover:bg-indigo-500/20 transition-colors"
                >
                  {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
                  {copied ? '已复制' : '复制'}
                </button>
              </div>
              <div className="bg-slate-900/80 border border-white/10 rounded-lg p-3 max-h-48 overflow-auto">
                <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap">
                  {JSON.stringify(configData.config_json, null, 2)}
                </pre>
              </div>
            </div>

            {/* 分步说明 */}
            {configData.instructions.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">配置步骤</label>
                <ol className="space-y-1.5">
                  {configData.instructions.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-400">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-medium flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* 验证方法 */}
            {configData.verification && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">验证方法</label>
                <div className="px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg text-sm text-green-300">
                  {configData.verification}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* ── 删除确认 ────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="删除对接服务"
        message={`确定要删除对接服务「${deleteTarget?.name}」吗？此操作不可撤销。`}
        loading={deleting}
      />
    </div>
  );
}
