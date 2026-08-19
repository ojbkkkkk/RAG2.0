import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  addToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => removeToast(id), 3000);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

const toastConfig: Record<ToastType, { icon: typeof CheckCircle; bg: string; border: string; iconColor: string; textColor: string }> = {
  success: { icon: CheckCircle, bg: 'bg-slate-800/90', border: 'border-green-500/30', iconColor: 'text-green-400', textColor: 'text-gray-200' },
  error: { icon: AlertCircle, bg: 'bg-slate-800/90', border: 'border-red-500/30', iconColor: 'text-red-400', textColor: 'text-gray-200' },
  info: { icon: Info, bg: 'bg-slate-800/90', border: 'border-blue-500/30', iconColor: 'text-blue-400', textColor: 'text-gray-200' },
  warning: { icon: AlertTriangle, bg: 'bg-slate-800/90', border: 'border-yellow-500/30', iconColor: 'text-yellow-400', textColor: 'text-gray-200' },
};

function ToastContainer({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-5 right-5 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const config = toastConfig[toast.type];
        const Icon = config.icon;
        return (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md ${config.bg} ${config.border} animate-toast-in`}
          >
            <Icon size={18} className={config.iconColor} />
            <p className={`text-sm ${config.textColor} flex-1`}>{toast.message}</p>
            <button
              onClick={() => onRemove(toast.id)}
              className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors flex-shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
