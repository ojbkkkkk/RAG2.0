import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './components/Toast';
import { ExtractionProvider } from './components/ExtractionContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Collections from './pages/Collections';
import CollectionDetail from './pages/CollectionDetail';
import DocumentDetail from './pages/DocumentDetail';
import Search from './pages/Search';
import Chat from './pages/Chat';
import KnowledgeGraph from './pages/KnowledgeGraph';
import Settings from './pages/Settings';
import Integrations from './pages/Integrations';
import Welcome from './pages/Welcome';
import { getSettings } from './api/client';

// ── Theme helpers ─────────────────────────────────────────

type Theme = 'dark' | 'light';

const THEME_KEY = 'rag-theme';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // ignore
  }
  return 'dark';
}

function applyTheme(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
}

// ── SystemContext ──────────────────────────────────────────

interface SystemContextValue {
  systemName: string;
  systemVersion: string;
  logoUrl: string | null;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  refreshSettings: () => Promise<void>;
}

const SystemContext = createContext<SystemContextValue | null>(null);

export function useSystem() {
  const ctx = useContext(SystemContext);
  if (!ctx) throw new Error('useSystem must be used within SystemProvider');
  return ctx;
}

function SystemProvider({ children }: { children: ReactNode }) {
  const [systemName, setSystemName] = useState('矩阵-知识库管理系统');
  const [systemVersion, setSystemVersion] = useState('v1.03');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // 首次挂载时立即应用主题，避免闪烁
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // ignore
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const data = await getSettings();
      setSystemName(data.system_name);
      setSystemVersion(data.system_version);
      setLogoUrl(data.logo_url);
    } catch {
      // 使用默认值
    }
  }, []);

  useEffect(() => {
    refreshSettings();
  }, [refreshSettings]);

  // 动态设置 document.title
  useEffect(() => {
    document.title = systemName;
  }, [systemName]);

  return (
    <SystemContext.Provider value={{ systemName, systemVersion, logoUrl, theme, setTheme, refreshSettings }}>
      {children}
    </SystemContext.Provider>
  );
}

// ── DefaultRedirect ───────────────────────────────────────

function DefaultRedirect() {
  const shown = sessionStorage.getItem('rag-welcome-shown');
  return <Navigate to={shown ? '/dashboard' : '/welcome'} replace />;
}

// ── App ────────────────────────────────────────────────────

export default function App() {
  return (
    <ToastProvider>
      <ExtractionProvider>
        <SystemProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/welcome" element={<Welcome />} />
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/collections" element={<Collections />} />
                <Route path="/collections/:id" element={<CollectionDetail />} />
                <Route path="/documents/:id" element={<DocumentDetail />} />
                <Route path="/search" element={<Search />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/knowledge-graph" element={<KnowledgeGraph />} />
                <Route path="/integrations" element={<Integrations />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<DefaultRedirect />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </SystemProvider>
      </ExtractionProvider>
    </ToastProvider>
  );
}
