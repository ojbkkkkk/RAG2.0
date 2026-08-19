import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import type { UploadTask, VectorizeTask, ExtractionTask } from '../types';
import {
  startUpload, getUploadTasks, cancelUploadTask,
  startVectorize, getVectorizeTasks, cancelVectorizeTask,
  getExtractionTasks, startExtraction, cancelExtraction,
} from '../api/client';

// ── 统一任务 Context 类型 ────────────────────────────────────

interface TaskContextType {
  // 上传任务
  uploadTasks: UploadTask[];
  startUploadTask: (collectionId: string, files: File[]) => Promise<void>;
  cancelUploadTaskAction: (taskId: string) => Promise<void>;

  // 向量化任务
  vectorizeTasks: VectorizeTask[];
  startVectorizeTask: (collectionId: string, documentIds: string[]) => Promise<void>;
  cancelVectorizeTaskAction: (taskId: string) => Promise<void>;

  // 实体提取任务
  extractionTasks: ExtractionTask[];
  startExtractionTask: (collectionId: string, documentIds?: string[]) => Promise<ExtractionTask>;
  cancelExtractionTaskAction: (taskId: string) => Promise<void>;

  // 兼容旧接口（供现有调用方使用）
  tasks: ExtractionTask[];
  activeTasks: ExtractionTask[];
  startTask: (collectionId: string, documentIds?: string[]) => Promise<ExtractionTask>;
  cancelTask: (taskId: string) => Promise<void>;

  // 通用
  refreshTasks: () => void;
  hasActiveTasks: boolean;
}

const TaskContext = createContext<TaskContextType | null>(null);

// ── Provider ─────────────────────────────────────────────────

export function ExtractionProvider({ children }: { children: React.ReactNode }) {
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [vectorizeTasks, setVectorizeTasks] = useState<VectorizeTask[]>([]);
  const [extractionTasks, setExtractionTasks] = useState<ExtractionTask[]>([]);

  const uploadPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vectorizePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const extractionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 刷新函数 ─────────────────────────────────────────────

  const refreshUploadTasks = useCallback(async () => {
    try {
      const data = await getUploadTasks();
      setUploadTasks(data);
    } catch { /* 静默失败 */ }
  }, []);

  const refreshVectorizeTasks = useCallback(async () => {
    try {
      const data = await getVectorizeTasks();
      setVectorizeTasks(data);
    } catch { /* 静默失败 */ }
  }, []);

  const refreshExtractionTasks = useCallback(async () => {
    try {
      const data = await getExtractionTasks();
      setExtractionTasks(data);
    } catch { /* 静默失败 */ }
  }, []);

  const refreshTasks = useCallback(() => {
    refreshUploadTasks();
    refreshVectorizeTasks();
    refreshExtractionTasks();
  }, [refreshUploadTasks, refreshVectorizeTasks, refreshExtractionTasks]);

  // ── 初次加载 ─────────────────────────────────────────────

  useEffect(() => { refreshTasks(); }, [refreshTasks]);

  // ── 轮询：上传任务 ────────────────────────────────────────

  const activeUploadTasks = uploadTasks.filter(t => t.status === 'pending' || t.status === 'running');

  useEffect(() => {
    if (activeUploadTasks.length > 0) {
      uploadPollRef.current = setInterval(refreshUploadTasks, 2000);
    } else {
      if (uploadPollRef.current) {
        clearInterval(uploadPollRef.current);
        uploadPollRef.current = null;
      }
    }
    return () => {
      if (uploadPollRef.current) clearInterval(uploadPollRef.current);
    };
  }, [activeUploadTasks.length, refreshUploadTasks]);

  // ── 轮询：向量化任务 ──────────────────────────────────────

  const activeVectorizeTasks = vectorizeTasks.filter(t => t.status === 'pending' || t.status === 'running');

  useEffect(() => {
    if (activeVectorizeTasks.length > 0) {
      vectorizePollRef.current = setInterval(refreshVectorizeTasks, 2000);
    } else {
      if (vectorizePollRef.current) {
        clearInterval(vectorizePollRef.current);
        vectorizePollRef.current = null;
      }
    }
    return () => {
      if (vectorizePollRef.current) clearInterval(vectorizePollRef.current);
    };
  }, [activeVectorizeTasks.length, refreshVectorizeTasks]);

  // ── 轮询：提取任务 ────────────────────────────────────────

  const activeExtractionTasks = extractionTasks.filter(t => t.status === 'pending' || t.status === 'running');

  useEffect(() => {
    if (activeExtractionTasks.length > 0) {
      extractionPollRef.current = setInterval(refreshExtractionTasks, 2000);
    } else {
      if (extractionPollRef.current) {
        clearInterval(extractionPollRef.current);
        extractionPollRef.current = null;
      }
    }
    return () => {
      if (extractionPollRef.current) clearInterval(extractionPollRef.current);
    };
  }, [activeExtractionTasks.length, refreshExtractionTasks]);

  // ── 操作函数 ─────────────────────────────────────────────

  const startUploadTask = useCallback(async (collectionId: string, files: File[]) => {
    await startUpload(collectionId, files);
    await refreshUploadTasks();
  }, [refreshUploadTasks]);

  const cancelUploadTaskAction = useCallback(async (taskId: string) => {
    await cancelUploadTask(taskId);
    await refreshUploadTasks();
  }, [refreshUploadTasks]);

  const startVectorizeTask = useCallback(async (collectionId: string, documentIds: string[]) => {
    await startVectorize(collectionId, documentIds);
    await refreshVectorizeTasks();
  }, [refreshVectorizeTasks]);

  const cancelVectorizeTaskAction = useCallback(async (taskId: string) => {
    await cancelVectorizeTask(taskId);
    await refreshVectorizeTasks();
  }, [refreshVectorizeTasks]);

  const startExtractionTask = useCallback(async (collectionId: string, documentIds?: string[]) => {
    const task = await startExtraction({ collection_id: collectionId, document_ids: documentIds });
    await refreshExtractionTasks();
    return task;
  }, [refreshExtractionTasks]);

  const cancelExtractionTaskAction = useCallback(async (taskId: string) => {
    await cancelExtraction(taskId);
    await refreshExtractionTasks();
  }, [refreshExtractionTasks]);

  const hasActiveTasks =
    activeUploadTasks.length > 0 ||
    activeVectorizeTasks.length > 0 ||
    activeExtractionTasks.length > 0;

  return (
    <TaskContext.Provider value={{
      uploadTasks,
      startUploadTask,
      cancelUploadTaskAction,
      vectorizeTasks,
      startVectorizeTask,
      cancelVectorizeTaskAction,
      extractionTasks,
      startExtractionTask,
      cancelExtractionTaskAction,
      // 兼容旧接口
      tasks: extractionTasks,
      activeTasks: activeExtractionTasks,
      startTask: startExtractionTask,
      cancelTask: cancelExtractionTaskAction,
      refreshTasks,
      hasActiveTasks,
    }}>
      {children}
    </TaskContext.Provider>
  );
}

// ── Hooks ─────────────────────────────────────────────────────

export function useTaskContext() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTaskContext must be used within ExtractionProvider');
  return ctx;
}

/** 兼容旧调用方 */
export function useExtraction() {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useExtraction must be used within ExtractionProvider');
  return ctx;
}
