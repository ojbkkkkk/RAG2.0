import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Square,
  Plus,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Bot,
  Database,
  BookOpen,
  Lightbulb,
} from 'lucide-react';
import { getCollections, sendChatMessage } from '../api/client';
import type { Collection, ChatMessage, ChatReference } from '../types';

// ── Simple Markdown renderer ──────────────────────────────

function SimpleMarkdown({ content }: { content: string }) {
  const html = renderMarkdown(content);
  return (
    <div
      className="prose-sm prose-invert max-w-none break-words"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Code blocks: ```lang\n...\n```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang: string, code: string) => {
    return `<pre class="bg-black/30 rounded-lg p-3 my-2 overflow-x-auto text-sm border border-white/5"><code${lang ? ` class="language-${lang}"` : ''}>${code.trim()}</code></pre>`;
  });

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code class="bg-white/10 px-1.5 py-0.5 rounded text-sm text-indigo-300">$1</code>');

  // Bold: **...**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-white">$1</strong>');

  // Italic: *...*
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-white mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-white mt-3 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-3 mb-2">$1</h1>');

  // Unordered lists: lines starting with - or *
  html = html.replace(/^[*-] (.+)$/gm, '<li class="ml-4 list-disc text-gray-200">$1</li>');

  // Ordered lists: lines starting with 1. 2. etc.
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal text-gray-200">$1</li>');

  // Line breaks
  html = html.replace(/\n/g, '<br/>');

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Reference Panel ───────────────────────────────────────

function ReferencePanel({ references }: { references: ChatReference[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!references || references.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-300 transition-colors"
      >
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>参考资料 ({references.length})</span>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          {references.map((ref, i) => (
            <div
              key={i}
              className="bg-white/5 border border-white/5 rounded-lg p-3 text-xs"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-gray-400 flex items-center gap-1">
                  <BookOpen size={12} />
                  {ref.metadata?.filename as string || ref.document_id}
                </span>
                <span className="text-indigo-400 font-medium">
                  {Math.round(ref.score * 100)}%
                </span>
              </div>
              <p className="text-gray-300 line-clamp-3 leading-relaxed">{ref.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Suggestion Chips ──────────────────────────────────────

const SUGGESTIONS = [
  { icon: Lightbulb, text: '这个知识库包含哪些主要内容？' },
  { icon: BookOpen, text: '请帮我总结相关文档的核心观点' },
  { icon: Database, text: '这些文档中有哪些关键数据？' },
];

// ── Main Chat Component ───────────────────────────────────

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load collections
  useEffect(() => {
    getCollections().then(setCollections).catch(() => {});
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleSend = useCallback(async (query?: string) => {
    const text = (query || input).trim();
    if (!text || isStreaming) return;

    // Add user message
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    // Add assistant placeholder
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      references: [],
      isStreaming: true,
      timestamp: Date.now() + 1,
    };

    const newMessages = [...messages, userMsg, assistantMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    // Build conversation history (last 10 turns = 20 messages)
    const history = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Abort any previous request
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await sendChatMessage(
        {
          query: text,
          collection_name: selectedCollection || undefined,
          conversation_history: history,
          use_hybrid: true,
          top_k: 5,
        },
        {
          onContext: (refs: ChatReference[]) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, references: refs } : m
              )
            );
          },
          onToken: (token: string) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + token }
                  : m
              )
            );
          },
          onDone: () => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, isStreaming: false } : m
              )
            );
            setIsStreaming(false);
            abortControllerRef.current = null;
          },
          onError: (error: string) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: `❌ ${error}`, isStreaming: false }
                  : m
              )
            );
            setIsStreaming(false);
            abortControllerRef.current = null;
          },
        },
        abortController.signal
      );
    } catch {
      // handled in callbacks
    }
  }, [input, isStreaming, messages, selectedCollection]);

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  }, []);

  const handleNewChat = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setMessages([]);
    setInput('');
    setIsStreaming(false);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (text: string) => {
    setInput(text);
    // Use setTimeout to ensure state is updated before sending
    setTimeout(() => handleSend(text), 0);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -m-6">
      {/* ── Top Toolbar ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Database size={16} />
            <span>知识库：</span>
          </div>
          <select
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-400/50 focus:ring-1 focus:ring-indigo-400/30 min-w-[160px]"
          >
            <option value="">所有知识库</option>
            {collections.map((col) => (
              <option key={col.id} value={col.name}>
                {col.name}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleNewChat}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Plus size={16} />
          新建对话
        </button>
      </div>

      {/* ── Messages Area ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <EmptyChatState onSuggestionClick={handleSuggestionClick} />
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input Area ── */}
      <div className="border-t border-white/10 bg-white/5 backdrop-blur-md px-5 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 bg-white/5 border border-white/10 rounded-xl p-2 focus-within:border-indigo-400/50 focus-within:ring-1 focus-within:ring-indigo-400/30 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入您的问题..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 resize-none focus:outline-none px-2 py-1.5 max-h-32 min-h-[36px]"
              style={{ height: 'auto', overflow: 'hidden' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 128) + 'px';
              }}
            />
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                title="停止生成"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="flex-shrink-0 w-9 h-9 flex items-center justify-center bg-gradient-to-r from-indigo-500 to-cyan-600 text-white rounded-lg hover:from-indigo-400 hover:to-cyan-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="发送"
              >
                <Send size={16} />
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            按 Enter 发送，Shift+Enter 换行
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-r from-indigo-600 to-cyan-600 rounded-2xl rounded-br-md px-4 py-3 text-sm text-white leading-relaxed">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/30 to-cyan-500/30 border border-indigo-400/20 flex items-center justify-center mt-0.5">
        <Bot size={16} className="text-indigo-300" />
      </div>
      <div className="max-w-[85%] min-w-0">
        <div className="bg-white/5 border border-white/10 rounded-2xl rounded-tl-md px-4 py-3 text-sm text-gray-200 leading-relaxed">
          <SimpleMarkdown content={message.content} />
          {message.isStreaming && (
            <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5 align-middle rounded-sm" />
          )}
        </div>
        {!message.isStreaming && message.references && message.references.length > 0 && (
          <ReferencePanel references={message.references} />
        )}
      </div>
    </div>
  );
}

// ── Empty Chat State ──────────────────────────────────────

function EmptyChatState({ onSuggestionClick }: { onSuggestionClick: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-cyan-500/20 border border-indigo-400/20 flex items-center justify-center mb-6">
        <Sparkles size={32} className="text-indigo-400" />
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">智能问答助手</h2>
      <p className="text-gray-400 text-sm mb-8 max-w-md">
        基于知识库内容回答您的问题，支持多轮对话与混合检索
      </p>
      <div className="grid gap-3 w-full max-w-lg">
        {SUGGESTIONS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(s.text)}
            className="flex items-center gap-3 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-300 hover:bg-white/10 hover:text-white hover:border-white/20 transition-all text-left group"
          >
            <s.icon size={18} className="text-gray-500 group-hover:text-indigo-400 transition-colors flex-shrink-0" />
            <span>{s.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
