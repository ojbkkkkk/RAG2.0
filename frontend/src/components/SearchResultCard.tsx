import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Database, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { SearchResult } from '../types';

interface SearchResultCardProps {
  result: SearchResult;
  query: string;
}

function highlightText(text: string, query: string) {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-indigo-500/30 text-white rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function getScoreGradient(score: number): string {
  const percent = Math.round(score * 100);
  if (percent >= 80) return 'from-green-500 to-emerald-400';
  if (percent >= 60) return 'from-yellow-400 to-amber-400';
  if (percent >= 40) return 'from-orange-400 to-orange-500';
  return 'from-red-500 to-red-400';
}

function getScoreTextColor(score: number): string {
  const percent = Math.round(score * 100);
  if (percent >= 80) return 'text-green-400';
  if (percent >= 60) return 'text-yellow-400';
  if (percent >= 40) return 'text-orange-400';
  return 'text-red-400';
}

export default function SearchResultCard({ result, query }: SearchResultCardProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const scorePercent = Math.round(result.score * 100);
  const isLong = result.content.length > 200;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback - ignore
    }
  };

  const handleNavigate = () => {
    navigate(`/documents/${result.document_id}`);
  };

  const displayContent = expanded ? result.content : result.content.slice(0, 200);
  const needsTruncate = isLong && !expanded;

  return (
    <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5 hover:bg-white/10 hover:border-white/20 shadow-lg shadow-black/20 transition-all">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <FileText size={14} className="flex-shrink-0" />
          <button
            onClick={handleNavigate}
            className="truncate max-w-[200px] text-indigo-400 hover:text-indigo-300 hover:underline transition-colors"
          >
            {result.document_name}
          </button>
          <span className="text-gray-300">|</span>
          <Database size={14} className="flex-shrink-0" />
          <span>{result.collection_name}</span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-semibold ${getScoreTextColor(result.score)}`}>{scorePercent}%</span>
          <div className="w-24 bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className={`h-2 rounded-full bg-gradient-to-r ${getScoreGradient(result.score)} transition-all`}
              style={{ width: `${scorePercent}%` }}
            />
          </div>
        </div>
      </div>
      <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
        {highlightText(displayContent, query)}
        {needsTruncate && '...'}
      </p>
      {/* Matched Entities */}
      {Array.isArray(result.metadata?.matched_entities) && (result.metadata.matched_entities as string[]).length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {(result.metadata.matched_entities as string[]).map((entity: string) => (
            <span key={entity} className="text-xs bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">
              {entity}
            </span>
          ))}
        </div>
      )}
      {/* Split Scores (hybrid search) */}
      {result.metadata?.vector_score != null && (
        <div className="text-xs text-gray-400 mt-1">
          向量: {((result.metadata.vector_score as number) * 100).toFixed(1)}% | 图谱: {(((result.metadata.graph_score as number) || 0) * 100).toFixed(1)}%
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
        <div className="flex items-center gap-2">
          {isLong && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {expanded ? '收起' : '展开全文'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
          >
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>
    </div>
  );
}
