import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, X, Upload, Layers, Brain } from 'lucide-react';
import { useTaskContext } from './ExtractionContext';
import { getCollections } from '../api/client';
import ConfirmDialog from './ConfirmDialog';
import type { UploadTask, VectorizeTask, ExtractionTask, Collection } from '../types';

// ── 每类任务的主题配置 ────────────────────────────────────────

const TASK_THEMES = {
  upload: {
    label: '文件上传中',
    icon: Upload,
    color: 'text-blue-400',
    badge: 'bg-blue-500/30 text-blue-300',
    bar: 'from-blue-500 to-sky-400',
  },
  vectorize: {
    label: '向量化处理中',
    icon: Layers,
    color: 'text-purple-400',
    badge: 'bg-purple-500/30 text-purple-300',
    bar: 'from-purple-500 to-violet-400',
  },
  extraction: {
    label: '深入学习中',
    icon: Brain,
    color: 'text-green-400',
    badge: 'bg-green-500/30 text-green-300',
    bar: 'from-green-500 to-emerald-400',
  },
} as const;

type TaskType = keyof typeof TASK_THEMES;

// ── 撤销目标类型 ─────────────────────────────────────────────

interface CancelTarget {
  type: TaskType;
  id: string;
  label: string;
}

// ── 子组件：单个任务分组 ──────────────────────────────────────

interface TaskGroupProps<T extends { id: string; status: string; progress: number; current_step: string }> {
  type: TaskType;
  tasks: T[];
  collectionNameMap: Record<string, string>;
  renderSubtitle: (task: T) => React.ReactNode;
  onCancel: (target: CancelTarget) => void;
}

function TaskGroup<T extends {
  id: string;
  collection_id: string;
  status: string;
  progress: number;
  current_step: string;
  error_message: string;
}>({ type, tasks, collectionNameMap, renderSubtitle, onCancel }: TaskGroupProps<T>) {
  const [collapsed, setCollapsed] = useState(false);
  const theme = TASK_THEMES[type];
  const Icon = theme.icon;

  const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'running');

  if (tasks.length === 0) return null;

  return (
    <div className="border-t border-white/10 first:border-t-0">
      {/* 分组标题 */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/5 transition-colors"
      >
        <Icon className={`${theme.color} flex-shrink-0`} size={15} />
        <span className="text-sm font-medium text-white">{theme.label}</span>
        {activeTasks.length > 0 && (
          <span className={`ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${theme.badge}`}>
            {activeTasks.length}
          </span>
        )}
        <span className="ml-auto">
          {collapsed
            ? <ChevronUp className="text-gray-500" size={14} />
            : <ChevronDown className="text-gray-500" size={14} />}
        </span>
      </button>

      {/* 任务列表 */}
      {!collapsed && (
        <div className="px-4 pb-3 space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="pt-1">
              {/* 任务标识 */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="text-xs text-gray-300 truncate"
                    title={collectionNameMap[task.collection_id] || task.collection_id}
                  >
                    {collectionNameMap[task.collection_id] || task.collection_id.slice(0, 8)}
                  </span>
                  {renderSubtitle(task)}
                </div>
                {task.status === 'failed' ? (
                  <span className="flex items-center gap-1 text-[10px] text-red-400 flex-shrink-0">
                    <XCircle size={11} /> 失败
                  </span>
                ) : task.status === 'completed' ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-400 flex-shrink-0">
                    <CheckCircle2 size={11} /> 完成
                  </span>
                ) : null}
              </div>

              {/* 当前步骤 */}
              {task.current_step && (
                <p className="text-[11px] text-gray-500 mb-1.5 truncate">{task.current_step}</p>
              )}

              {/* 进度条 */}
              <div className="relative h-1.5 bg-white/5 rounded-full overflow-hidden mb-1">
                <div
                  className={`absolute inset-y-0 left-0 bg-gradient-to-r ${theme.bar} rounded-full transition-all duration-500`}
                  style={{ width: `${Math.min(100, Math.round(task.progress * 100))}%` }}
                />
              </div>

              {/* 进度数值 + 撤销按钮 */}
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-500">
                  {Math.round(task.progress * 100)}%
                </span>
                {task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled' && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onCancel({
                        type,
                        id: task.id,
                        label: collectionNameMap[task.collection_id] || task.collection_id.slice(0, 8),
                      });
                    }}
                    className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                  >
                    撤销
                  </button>
                )}
              </div>

              {/* 失败信息 */}
              {task.status === 'failed' && task.error_message && (
                <p className="text-[10px] text-red-400/80 mt-1 truncate" title={task.error_message}>
                  {task.error_message}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────

export default function ExtractionProgress() {
  const { uploadTasks, vectorizeTasks, extractionTasks, cancelUploadTaskAction, cancelVectorizeTaskAction, cancelExtractionTaskAction } = useTaskContext();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [completedUploadIds, setCompletedUploadIds] = useState<Set<string>>(new Set());
  const [completedVectorizeIds, setCompletedVectorizeIds] = useState<Set<string>>(new Set());
  const [completedExtractionIds, setCompletedExtractionIds] = useState<Set<string>>(new Set());

  const prevUploadActiveIds = useRef<Set<string>>(new Set());
  const prevVectorizeActiveIds = useRef<Set<string>>(new Set());
  const prevExtractionActiveIds = useRef<Set<string>>(new Set());

  const collectionNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    collections.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [collections]);

  useEffect(() => {
    getCollections().then(setCollections).catch(() => {});
  }, []);

  // ── 检测任务完成 ────────────────────────────────────────────

  function detectCompleted(
    activeTasks: { id: string }[],
    prevIds: React.MutableRefObject<Set<string>>,
    setCompleted: React.Dispatch<React.SetStateAction<Set<string>>>
  ) {
    const currentIds = new Set(activeTasks.map(t => t.id));
    const newlyDone: string[] = [];
    prevIds.current.forEach(id => { if (!currentIds.has(id)) newlyDone.push(id); });
    if (newlyDone.length > 0) {
      setCompleted(prev => {
        const next = new Set(prev);
        newlyDone.forEach(id => next.add(id));
        return next;
      });
      setShowSuccess(true);
    }
    prevIds.current = currentIds;
  }

  const activeUpload = uploadTasks.filter(t => t.status === 'pending' || t.status === 'running');
  const activeVectorize = vectorizeTasks.filter(t => t.status === 'pending' || t.status === 'running');
  const activeExtraction = extractionTasks.filter(t => t.status === 'pending' || t.status === 'running');

  useEffect(() => { detectCompleted(activeUpload, prevUploadActiveIds, setCompletedUploadIds); }, [activeUpload]);
  useEffect(() => { detectCompleted(activeVectorize, prevVectorizeActiveIds, setCompletedVectorizeIds); }, [activeVectorize]);
  useEffect(() => { detectCompleted(activeExtraction, prevExtractionActiveIds, setCompletedExtractionIds); }, [activeExtraction]);

  // ── 成功提示 3 秒消失 ────────────────────────────────────────

  useEffect(() => {
    if (!showSuccess) return;
    const timer = setTimeout(() => {
      setShowSuccess(false);
      setCompletedUploadIds(new Set());
      setCompletedVectorizeIds(new Set());
      setCompletedExtractionIds(new Set());
    }, 3000);
    return () => clearTimeout(timer);
  }, [showSuccess]);

  // ── 合并展示：活跃 + 刚完成 ─────────────────────────────────

  const displayUploadTasks = [
    ...activeUpload,
    ...uploadTasks.filter(t => completedUploadIds.has(t.id) && (t.status === 'completed' || t.status === 'failed')),
  ];

  const displayVectorizeTasks = [
    ...activeVectorize,
    ...vectorizeTasks.filter(t => completedVectorizeIds.has(t.id) && (t.status === 'completed' || t.status === 'failed')),
  ];

  const displayExtractionTasks = [
    ...activeExtraction,
    ...extractionTasks.filter(t => completedExtractionIds.has(t.id) && (t.status === 'completed' || t.status === 'failed')),
  ];

  const hasAnything =
    displayUploadTasks.length > 0 ||
    displayVectorizeTasks.length > 0 ||
    displayExtractionTasks.length > 0;

  const hasActiveAny = activeUpload.length > 0 || activeVectorize.length > 0 || activeExtraction.length > 0;

  // 没有活跃任务且没有需要展示的完成结果时隐藏
  if (!hasAnything && !showSuccess) return null;

  // ── 撤销处理 ─────────────────────────────────────────────────

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      if (cancelTarget.type === 'upload') await cancelUploadTaskAction(cancelTarget.id);
      else if (cancelTarget.type === 'vectorize') await cancelVectorizeTaskAction(cancelTarget.id);
      else await cancelExtractionTaskAction(cancelTarget.id);
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };

  // ── 取消弹窗文案 ─────────────────────────────────────────────

  const cancelMessages: Record<TaskType, string> = {
    upload: '确定要撤销此上传任务吗？已处理的文件将被保留，但未完成的文件将停止处理。',
    vectorize: '确定要撤销此向量化任务吗？已向量化的数据将被保留，但未完成的部分将停止处理。',
    extraction: '确定要撤销此深入学习任务吗？已提取的数据将被保留，但未完成的部分将停止处理。',
  };

  const cancelTitles: Record<TaskType, string> = {
    upload: '撤销上传任务',
    vectorize: '撤销向量化任务',
    extraction: '撤销深入学习任务',
  };

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 w-80">
        {/* 全部完成提示 */}
        {showSuccess && !hasActiveAny && (
          <div className="bg-gray-900/95 backdrop-blur-xl border border-emerald-500/30 rounded-xl shadow-2xl px-4 py-3 mb-2 flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="text-emerald-400 flex-shrink-0" size={18} />
            <span className="text-sm text-emerald-300">任务完成</span>
            <button
              onClick={() => setShowSuccess(false)}
              className="ml-auto text-gray-500 hover:text-gray-300 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* 进度卡片 */}
        {hasAnything && (
          <div className="bg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
            {/* 顶部全局标题 */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/10">
              <Loader2 className="text-gray-400 animate-spin flex-shrink-0" size={14} />
              <span className="text-xs text-gray-400 font-medium">任务进度</span>
            </div>

            {/* 上传任务分组 */}
            <TaskGroup<UploadTask>
              type="upload"
              tasks={displayUploadTasks}
              collectionNameMap={collectionNameMap}
              renderSubtitle={task => (
                <span className="text-[10px] text-gray-500 flex-shrink-0">
                  {task.processed_files}/{task.total_files} 个文件
                </span>
              )}
              onCancel={setCancelTarget}
            />

            {/* 向量化任务分组 */}
            <TaskGroup<VectorizeTask>
              type="vectorize"
              tasks={displayVectorizeTasks}
              collectionNameMap={collectionNameMap}
              renderSubtitle={task => (
                <span className="text-[10px] text-gray-500 flex-shrink-0">
                  {task.processed_chunks}/{task.total_chunks} chunks
                </span>
              )}
              onCancel={setCancelTarget}
            />

            {/* 提取任务分组 */}
            <TaskGroup<ExtractionTask>
              type="extraction"
              tasks={displayExtractionTasks}
              collectionNameMap={collectionNameMap}
              renderSubtitle={task => (
                <span className="text-[10px] text-gray-500 flex-shrink-0">
                  {task.document_ids && task.document_ids.length > 0
                    ? `${task.document_ids.length} 个文档`
                    : '整个知识库'}
                </span>
              )}
              onCancel={setCancelTarget}
            />
          </div>
        )}
      </div>

      {/* 撤销确认弹窗 */}
      <ConfirmDialog
        isOpen={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleConfirmCancel}
        title={cancelTarget ? cancelTitles[cancelTarget.type] : '撤销任务'}
        message={cancelTarget ? cancelMessages[cancelTarget.type] : ''}
        confirmLabel="确认撤销"
        loading={cancelling}
      />
    </>
  );
}
