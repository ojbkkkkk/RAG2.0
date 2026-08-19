import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText, Layers, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { getDocument, getDocumentChunks } from '../api/client';
import type { Document, Chunk } from '../types';
import { Skeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';

export default function DocumentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [document, setDocument] = useState<Document | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedChunks, setExpandedChunks] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const fetch = async () => {
      try {
        setLoading(true);
        const [doc, chunkList] = await Promise.all([getDocument(id), getDocumentChunks(id)]);
        setDocument(doc);
        setChunks(chunkList);
      } catch {
        addToast('error', '获取文档详情失败');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [id, addToast]);

  const toggleChunk = (chunkId: string) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(chunkId)) next.delete(chunkId);
      else next.add(chunkId);
      return next;
    });
  };

  const handleCopy = async (chunkId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(chunkId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      addToast('error', '复制失败');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('zh-CN');
  };

  const chunkBgColors = [
    'bg-white/5',
    'bg-transparent',
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-4 w-32 rounded" />
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <Skeleton className="w-12 h-12 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-3/4 rounded" />
              <Skeleton className="h-4 w-1/2 rounded" />
            </div>
          </div>
        </div>
        <Skeleton className="h-5 w-24 rounded" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="border border-white/10 rounded-lg p-4">
            <Skeleton className="h-4 w-full rounded mb-2" />
            <Skeleton className="h-4 w-4/5 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!document) return <div className="text-gray-400">文档不存在</div>;

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate(`/collections/${document.collection_id}`)}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white mb-4 transition-colors"
      >
        <ArrowLeft size={16} />
        返回知识库
      </button>

      {/* Document Info */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
            <FileText className="text-indigo-400" size={24} />
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-white mb-2">{document.filename}</h1>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-gray-400">
              <span>
                类型：<span className="font-mono bg-white/10 text-gray-300 px-1.5 py-0.5 rounded text-xs">{document.file_type}</span>
              </span>
              <span>大小：{formatSize(document.file_size)}</span>
              <span className="flex items-center gap-1">
                <Layers size={14} />
                {document.chunk_count} 个分块
              </span>
              <span>
                状态：
                <span
                  className={`font-medium ${
                    document.status === 'completed'
                      ? 'text-green-400'
                      : document.status === 'processing'
                        ? 'text-yellow-400'
                        : document.status === 'failed'
                          ? 'text-red-400'
                          : 'text-gray-400'
                  }`}
                >
                  {document.status === 'completed'
                    ? '已完成'
                    : document.status === 'processing'
                      ? '处理中'
                      : document.status === 'failed'
                        ? '失败'
                        : document.status}
                </span>
              </span>
              <span>上传时间：{formatDate(document.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chunks */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">分块预览</h2>
        <span className="text-sm text-gray-500">{chunks.length} 个分块</span>
      </div>

      {chunks.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500">暂无分块数据</div>
      ) : (
        <div className="space-y-0">
          {chunks.map((chunk, i) => {
            const isExpanded = expandedChunks.has(chunk.id);
            const isLong = chunk.content.length > 300;

            return (
              <div
                key={chunk.id}
                className={`border border-white/10 ${chunkBgColors[i % 2]} first:rounded-t-xl last:rounded-b-xl ${i > 0 ? '-mt-px' : ''} animate-stagger`}
                style={{ animationDelay: `${i * 30}ms` }}
              >
                <div
                  className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => toggleChunk(chunk.id)}
                >
                  <span className="text-xs font-mono text-gray-500 bg-white/10 px-2 py-0.5 rounded flex-shrink-0">
                    #{chunk.chunk_index}
                  </span>
                  <p className="text-sm text-gray-400 flex-1 truncate">
                    {isExpanded ? '' : chunk.content.slice(0, 150) + (chunk.content.length > 150 ? '...' : '')}
                  </p>
                  <div className="flex items-center gap-1">
                    {isExpanded && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(chunk.id, chunk.content);
                        }}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                        title="复制内容"
                      >
                        {copiedId === chunk.id ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                      </button>
                    )}
                    {isLong && (
                      <span className="flex-shrink-0 text-gray-400">
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-5 pb-4">
                    <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap bg-white/5 rounded-lg p-4 border border-white/10">
                      {chunk.content}
                    </div>
                    {chunk.metadata && Object.keys(chunk.metadata).length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-gray-400 mb-1">元数据</p>
                        <pre className="text-xs text-gray-400 bg-white/5 rounded p-2 border border-white/10 overflow-x-auto">
                          {JSON.stringify(chunk.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
