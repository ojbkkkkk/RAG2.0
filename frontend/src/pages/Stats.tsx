import { useEffect, useState } from 'react';
import { Database, FileText, Layers, File } from 'lucide-react';
import { getCollections, getSupportedFormats } from '../api/client';
import type { Collection } from '../types';
import StatsCard from '../components/StatsCard';
import { CardSkeleton } from '../components/Skeleton';
import { useToast } from '../components/Toast';

export default function Stats() {
  const { addToast } = useToast();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      try {
        const [cols, fmts] = await Promise.all([getCollections(), getSupportedFormats()]);
        setCollections(cols);
        setFormats(fmts);
      } catch {
        addToast('error', '获取统计数据失败');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [addToast]);

  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <div className="h-8 w-32 bg-white/10 rounded animate-pulse mb-2" />
          <div className="h-4 w-48 bg-white/10 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  const totalDocs = collections.reduce((sum, c) => sum + c.document_count, 0);
  const totalChunks = collections.reduce((sum, c) => sum + c.chunk_count, 0);
  const maxDocs = Math.max(...collections.map((c) => c.document_count), 1);
  const maxChunks = Math.max(...collections.map((c) => c.chunk_count), 1);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">统计概览</h1>
        <p className="text-sm text-gray-400 mt-1">知识库系统整体统计信息</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <StatsCard label="知识库总数" value={collections.length} icon={<Database size={20} />} />
        <StatsCard label="文档总数" value={totalDocs} icon={<FileText size={20} />} />
        <StatsCard label="分块总数" value={totalChunks} icon={<Layers size={20} />} />
      </div>

      {/* Bar Charts */}
      {collections.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Document count chart */}
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4">各知识库文档数</h3>
            <div className="space-y-3">
              {collections.map((col) => (
                <div key={col.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 w-28 truncate flex-shrink-0" title={col.name}>
                    {col.name}
                  </span>
                  <div className="flex-1 bg-white/10 rounded-full h-6 relative overflow-hidden">
                    <div
                      className="bg-indigo-500 h-6 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{ width: `${Math.max((col.document_count / maxDocs) * 100, 8)}%` }}
                    >
                      <span className="text-xs font-medium text-white">
                        {col.document_count}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Chunk count chart */}
          <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-4">各知识库分块数</h3>
            <div className="space-y-3">
              {collections.map((col) => (
                <div key={col.id} className="flex items-center gap-3">
                  <span className="text-sm text-gray-400 w-28 truncate flex-shrink-0" title={col.name}>
                    {col.name}
                  </span>
                  <div className="flex-1 bg-white/10 rounded-full h-6 relative overflow-hidden">
                    <div
                      className="bg-emerald-500 h-6 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                      style={{ width: `${Math.max((col.chunk_count / maxChunks) * 100, 8)}%` }}
                    >
                      <span className="text-xs font-medium text-white">
                        {col.chunk_count}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Supported Formats */}
      {formats.length > 0 && (
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-4">支持的文件格式</h3>
          <div className="flex flex-wrap gap-2">
            {formats.map((fmt) => (
              <span
                key={fmt}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-400"
              >
                <File size={14} className="text-gray-500" />
                {fmt}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
