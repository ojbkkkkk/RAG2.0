import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Database,
  Network,
  Search,
  MessageSquare,
  Plug,
  Settings as SettingsIcon,
  BookOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useSystem } from '../App';

const navItems = [
  { to: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { to: '/collections', label: '知识库管理', icon: Database },
  { to: '/knowledge-graph', label: '知识图谱', icon: Network },
  { to: '/search', label: '语义检索', icon: Search },
  { to: '/chat', label: '智能问答', icon: MessageSquare },
  { to: '/integrations', label: '对接配置', icon: Plug },
  { to: '/settings', label: '系统配置', icon: SettingsIcon },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { systemName, systemVersion } = useSystem();

  return (
    <aside
      className={`sidebar-transition flex-shrink-0 theme-sidebar backdrop-blur-xl border-r flex flex-col h-full relative ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className={`px-5 py-6 flex items-center gap-2.5 ${collapsed ? 'justify-center px-3' : ''}`}>
        <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-4.5 h-4.5 text-white" size={18} />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-base font-semibold theme-text">{systemName || '矩阵-知识库管理系统'}</span>
            <span className="text-xs theme-text-muted">{systemVersion || 'v1.03'}</span>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative ${
                collapsed ? 'justify-center' : ''
              } ${
                isActive
                  ? 'text-white border-l-2 border-indigo-400 -ml-[2px] pl-[20px]'
                  : 'theme-text-secondary hover:bg-white/10 hover:text-white'
              }`
            }
            style={({ isActive }) =>
              isActive
                ? { background: `linear-gradient(to right, var(--sidebar-active-from), var(--sidebar-active-to))` }
                : undefined
            }
          >
            <item.icon size={18} className="flex-shrink-0" />
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle button */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 theme-surface backdrop-blur-sm theme-border rounded-full flex items-center justify-center theme-text-muted hover:text-white hover:border-white/20 transition-all z-10"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <div className={`px-5 py-4 border-t border-white/5 ${collapsed ? 'px-3' : ''}`}>
        {!collapsed && <p className="text-xs theme-text-muted">{systemName || '矩阵-知识库管理系统'} {systemVersion || 'v1.03'}</p>}
      </div>
    </aside>
  );
}
