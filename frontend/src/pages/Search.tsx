import { useEffect, useState, useCallback } from 'react';
import { Search as SearchIcon, Clock, X } from 'lucide-react';
import { search, searchGraph, searchHybrid, getCollections } from '../api/client';
import type { Collection, SearchResult } from '../types';
import SearchResultCard from '../components/SearchResultCard';
import { SearchSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useToast } from '../components/Toast';

const SEARCH_HISTORY_KEY = 'rag2-search-history';
const MAX_HISTORY = 10;

function getSearchHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function addSearchHistory(query: string) {
  try {
    const history = getSearchHistory().filter(h => h !== query);
    history.unshift(query);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

function removeSearchHistory(query: string) {
  try {
    const history = getSearchHistory().filter(h => h !== query);
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
  } catch {
    // ignore
  }
}

export default function Search() {
  const { addToast } = useToast();
  const [query, setQuery] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [topK, setTopK] = useState(5);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [searchHistory, setSearchHistory] = useState<string[]>(getSearchHistory());
  const [retrievalMode, setRetrievalMode] = useState<'vector' | 'graph' | 'hybrid'>('hybrid');

  useEffect(() => {
    getCollections().then(setCollections).catch(() => {});
  }, []);

  const handleSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;
    try {
      setSearching(true);
      setHasSearched(true);
      const params = {
        query: q.trim(),
        collection_name: selectedCollection || undefined,
        top_k: topK,
      };
      let res;
      switch (retrievalMode) {
        case 'vector':
          res = await search(params);
          break;
        case 'graph':
          res = await searchGraph(params);
          break;
        case 'hybrid':
        default:
          res = await searchHybrid(params);
          break;
      }
      setResults(res.results || []);
      addSearchHistory(q.trim());
      setSearchHistory(getSearchHistory());
      if (q.trim() !== query) setQuery(q.trim());
      addToast('info', `找到 ${(res.results || []).length} 条相关结果`);
    } catch {
      setResults([]);
      addToast('error', '搜索失败，请重试');
    } finally {
      setSearching(false);
    }
  }, [query, selectedCollection, topK, retrievalMode, addToast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleHistoryClick = (q: string) => {
    setQuery(q);
    handleSearch(q);
  };

  const handleRemoveHistory = (q: string) => {
    removeSearchHistory(q);
    setSearchHistory(getSearchHistory());
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">检索测试</h1>
        <p className="text-sm text-gray-400 mt-1">在知识库中搜索相关内容</p>
      </div>

      {/* Search Bar */}
      <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5 mb-6">
        {/* Retrieval Mode Selector */}
        <div className="flex gap-2 mb-3">
          {[
            { key: 'hybrid', label: '混合检索', icon: '🔗' },
            { key: 'vector', label: '向量检索', icon: '📐' },
            { key: 'graph', label: '图谱检索', icon: '🕸️' },
          ].map(mode => (
            <button
              key={mode.key}
              onClick={() => setRetrievalMode(mode.key as 'vector' | 'graph' | 'hybrid')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                retrievalMode === mode.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
              }`}
            >
              {mode.icon} {mode.label}
            </button>
          ))}
        </div>
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <SearchIcon
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入搜索关键词..."
              className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            />
          </div>
          <select
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30 min-w-[160px]"
          >
            <option value="">全部知识库</option>
            {collections.map((col) => (
              <option key={col.id} value={col.name}>
                {col.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400 whitespace-nowrap">Top K:</label>
            <input
              type="number"
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value) || 5)}
              min={1}
              max={20}
              className="w-16 px-2 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-center text-white focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30"
            />
          </div>
          <button
            onClick={() => handleSearch()}
            disabled={searching || !query.trim()}
            className="px-6 py-2.5 bg-gradient-to-r from-indigo-500 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors disabled:opacity-50 btn-hover-scale"
          >
            {searching ? '搜索中...' : '搜索'}
          </button>
        </div>
      </div>

      {/* Results */}
      {searching ? (
        <SearchSkeleton />
      ) : hasSearched && results.length === 0 ? (
        <EmptyState
          variant="search"
          title="未找到相关结果"
          description="尝试使用不同的关键词或调整搜索参数"
        />
      ) : results.length > 0 ? (
        <div>
          <p className="text-sm text-gray-400 mb-4">找到 {results.length} 条相关结果</p>
          <div className="space-y-4">
            {results.map((result, i) => (
              <div
                key={`${result.document_id}-${result.chunk_index}-${i}`}
                className="animate-stagger"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <SearchResultCard result={result} query={query} />
              </div>
            ))}
          </div>
        </div>
      ) : !hasSearched && searchHistory.length > 0 ? (
        <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} className="text-gray-500" />
            <h3 className="text-sm font-medium text-gray-300">最近搜索</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((q) => (
              <div
                key={q}
                className="group flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-400 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <span onClick={() => handleHistoryClick(q)}>{q}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveHistory(q);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-all"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          variant="search"
          title="输入关键词开始搜索"
          description="在知识库中检索相关文档片段"
        />
      )}
    </div>
  );
}
