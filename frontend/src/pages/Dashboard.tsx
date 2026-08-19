import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Database,
  FileText,
  Layers,
  Cpu,
  Server,
  BrainCircuit,
  HardDrive,
  ScanText,
  RefreshCw,
  Bot,
  GitBranch,
  Waypoints,
} from 'lucide-react';
import { getCollections, getSystemStatus, getDashboardGraphStats } from '../api/client';
import type { Collection, SystemStatus, DashboardGraphStats } from '../types';
import { useToast } from '../components/Toast';
import { useSystem } from '../App';
import MatrixDynamicLogo from '../components/MatrixDynamicLogo';

/* ═══════════════════════════════════════════════════════════════
   useCountUp — 数字从0滚动到目标值
   ═══════════════════════════════════════════════════════════════ */

function useCountUp(target: number, duration = 1500) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

/* ═══════════════════════════════════════════════════════════════
   顶部统计卡片
   ═══════════════════════════════════════════════════════════════ */

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
  accentSoft: string;
  trend?: string;
  delay?: number;
}

function StatCard({ label, value, icon, accent, accentSoft, trend, delay = 0 }: StatCardProps) {
  const { theme } = useSystem();
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0);
  const displayValue = typeof value === 'number' ? animatedValue : value;
  const isLight = theme === 'light';

  return (
    <div
      className={`premium-stat-card card-hover-scale relative overflow-hidden rounded-2xl border p-5 shadow-2xl backdrop-blur-2xl animate-fadeInUp ${
        isLight ? 'border-white/80 text-slate-900' : 'border-white/15 text-white'
      }`}
      style={{
        animationDelay: `${delay}ms`,
        background: isLight
          ? `linear-gradient(135deg, rgba(255,255,255,0.82), rgba(238,242,255,0.58)), radial-gradient(circle at 12% 0%, ${accentSoft}, transparent 52%)`
          : `linear-gradient(135deg, rgba(15,23,42,0.64), rgba(30,41,59,0.38)), radial-gradient(circle at 14% 0%, ${accentSoft}, transparent 54%)`,
        boxShadow: isLight
          ? `0 20px 48px rgba(79,70,229,0.12), inset 0 1px 0 rgba(255,255,255,0.92)`
          : `0 22px 56px rgba(0,0,0,0.34), 0 0 34px ${accentSoft}, inset 0 1px 0 rgba(255,255,255,0.16)`,
      }}
    >
      <div className="pointer-events-none absolute inset-px rounded-2xl bg-gradient-to-br from-white/18 via-transparent to-transparent" />
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full blur-2xl"
        style={{ background: accentSoft }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 h-px w-full opacity-80"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${isLight ? 'text-slate-500' : 'text-slate-300/80'}`}>{label}</p>
          <p className={`mt-2 text-3xl font-bold tracking-tight animate-numberPop ${isLight ? 'text-slate-950' : 'text-white'}`}>
            {displayValue}
          </p>
        </div>
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 shadow-lg backdrop-blur-xl"
          style={{ color: accent, boxShadow: `0 10px 28px ${accentSoft}` }}
        >
          {icon}
        </div>
      </div>
      {trend && (
        <p className={`relative mt-4 text-xs font-medium ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>{trend}</p>
      )}
    </div>
  );
}

function MatrixLogoCard() {
  const { theme } = useSystem();
  const isLight = theme === 'light';
  const accentColor = isLight ? '#4f46e5' : '#818cf8';
  const faceBg = isLight ? 'rgba(238,242,255,0.78)' : 'rgba(15,23,42,0.68)';
  const textColor = isLight ? '#312e81' : '#c4b5fd';

  return (
    <div
      className={`relative flex aspect-square min-h-[232px] items-center justify-center overflow-visible rounded-3xl border shadow-2xl backdrop-blur-2xl ${
        isLight ? 'border-white/80 bg-white/70' : 'border-white/15 bg-slate-900/42'
      }`}
      style={{
        boxShadow: isLight
          ? '0 24px 60px rgba(79,70,229,0.14), inset 0 1px 0 rgba(255,255,255,0.95)'
          : '0 26px 70px rgba(0,0,0,0.36), 0 0 46px rgba(99,102,241,0.18), inset 0 1px 0 rgba(255,255,255,0.16)',
      }}
    >
      <div className="pointer-events-none absolute inset-px rounded-3xl bg-gradient-to-br from-white/18 via-transparent to-transparent" />
      <div className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 h-48 w-48 rounded-full bg-violet-500/24 blur-3xl" />
      <div className="pointer-events-none absolute inset-5 rounded-2xl border border-white/10" />
      <div className="relative z-20 -translate-y-4 translate-x-6 drop-shadow-[0_24px_34px_rgba(99,102,241,0.18)]">
        <MatrixDynamicLogo
          size={218}
          accentColor={accentColor}
          faceBg={faceBg}
          textColor={textColor}
          glow="subtle"
        />
      </div>
      <div className="absolute bottom-4 left-5 right-5 z-10 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.24em] text-indigo-300/70">
        <span>Matrix</span>
        <span>Dynamic Logo</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   环形图组件 — 纯 SVG + CSS
   ═══════════════════════════════════════════════════════════════ */

const TRACK_COLOR_DARK = '#1e293b';
const TRACK_COLOR_LIGHT = '#e2e8f0';

const RING_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a78bfa', // purple-light
  '#c084fc', // purple
  '#e879f9', // fuchsia
  '#f472b6', // pink
  '#fb923c', // orange
  '#34d399', // emerald
];

const ENTITY_TYPE_LABELS: Record<string, string> = {
  PERSON: '人物',
  PEOPLE: '人物',
  ORGANIZATION: '组织机构',
  ORG: '组织机构',
  COMPANY: '公司',
  ENTERPRISE: '企业',
  LOCATION: '地点',
  LOC: '地点',
  GEO: '地理位置',
  PRODUCT: '产品',
  SERVICE: '服务',
  TECHNOLOGY: '技术',
  TECH: '技术',
  SYSTEM: '系统',
  PLATFORM: '平台',
  VULNERABILITY: '漏洞',
  CVE: '漏洞编号',
  ATTACK: '攻击方式',
  THREAT: '威胁',
  MALWARE: '恶意软件',
  INDUSTRY: '行业',
  POLICY: '政策',
  STANDARD: '标准规范',
  CONCEPT: '概念',
  EVENT: '事件',
  DATE: '日期',
  TIME: '时间',
  METRIC: '指标',
  OTHER: '其他',
};

function formatEntityTypeLabel(type: string) {
  const normalized = type.trim().replace(/[\s-]+/g, '_').toUpperCase();
  return ENTITY_TYPE_LABELS[normalized] ?? type;
}

interface DonutChartProps {
  segments: { name: string; value: number }[];
  centerLabel?: string;
  centerValue?: number;
}

function DonutChart({ segments, centerLabel = '文档总数', centerValue }: DonutChartProps) {
  const { theme } = useSystem();
  const trackColor = theme === 'light' ? TRACK_COLOR_LIGHT : TRACK_COLOR_DARK;
  const total = centerValue ?? segments.reduce((s, seg) => s + seg.value, 0);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  let accumulated = 0;

  if (total === 0 && segments.length === 0) {
    return (
      <div className="flex flex-col items-center">
        <svg width="180" height="180" viewBox="0 0 180 180">
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth="16"
          />
          <text x="90" y="86" textAnchor="middle" className={theme === 'light' ? 'fill-gray-400 text-sm' : 'fill-gray-400 text-sm'} fontSize="13">
            暂无数据
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <svg width="180" height="180" viewBox="0 0 180 180" className="flex-shrink-0">
        {/* background track */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth="16"
        />
        {segments.map((seg, i) => {
          const pct = seg.value / (segments.reduce((s, seg2) => s + seg2.value, 0) || 1);
          const dashLength = pct * circumference;
          const gap = circumference - dashLength;
          const rotation = accumulated * 360;
          accumulated += pct;
          return (
            <circle
              key={seg.name}
              cx="90"
              cy="90"
              r={radius}
              fill="none"
              stroke={RING_COLORS[i % RING_COLORS.length]}
              strokeWidth="16"
              strokeDasharray={`${dashLength} ${gap}`}
              strokeDashoffset={0}
              strokeLinecap="round"
              transform={`rotate(${rotation - 90} 90 90)`}
              style={{
                transition: 'stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease',
              }}
            />
          );
        })}
        {/* center text */}
        <text x="90" y="82" textAnchor="middle" className={theme === 'light' ? 'fill-gray-800 font-bold' : 'fill-white font-bold'} fontSize="24">
          {total}
        </text>
        <text x="90" y="102" textAnchor="middle" className={theme === 'light' ? 'fill-gray-500' : 'fill-gray-400'} fontSize="11">
          {centerLabel}
        </text>
      </svg>
      {/* legend */}
      <div className="flex flex-col gap-2 text-sm">
        {segments.map((seg, i) => (
          <div key={seg.name} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full flex-shrink-0"
              style={{ backgroundColor: RING_COLORS[i % RING_COLORS.length] }}
            />
            <span className={theme === 'light' ? 'text-gray-700 truncate max-w-[100px]' : 'text-gray-300 truncate max-w-[100px]'} title={seg.name}>
              {seg.name}
            </span>
            <span className={theme === 'light' ? 'text-gray-400 ml-auto pl-2' : 'text-gray-500 ml-auto pl-2'}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   磁盘占用可视化
   ═══════════════════════════════════════════════════════════════ */

interface DiskUsageChartProps {
  diskUsage: DashboardGraphStats['disk_usage'] | null;
}

const DISK_ITEMS = [
  { key: 'chroma_mb' as const, label: '向量库', color: '#6366f1' },
  { key: 'sqlite_mb' as const, label: '数据库', color: '#8b5cf6' },
  { key: 'markdown_mb' as const, label: 'Markdown', color: '#06b6d4' },
  { key: 'uploads_mb' as const, label: '上传文件', color: '#f472b6' },
];

function DiskUsageChart({ diskUsage }: DiskUsageChartProps) {
  const { theme } = useSystem();

  if (!diskUsage) {
    return (
      <div className="flex items-center justify-center h-44 text-sm text-gray-500">
        暂无数据
      </div>
    );
  }

  const total = diskUsage.total_mb || 1;
  const maxItem = Math.max(diskUsage.chroma_mb, diskUsage.sqlite_mb, diskUsage.markdown_mb, diskUsage.uploads_mb, 1);

  return (
    <div className="space-y-4">
      {DISK_ITEMS.map((item, idx) => {
        const mb = diskUsage[item.key];
        const widthPct = (mb / maxItem) * 100;
        return (
          <div key={item.key} className="flex items-center gap-3">
            <span className={`text-xs font-medium w-16 text-right ${theme === 'light' ? 'text-gray-600' : 'text-gray-400'}`}>
              {item.label}
            </span>
            <div className={`flex-1 h-5 rounded-full overflow-hidden ${theme === 'light' ? 'bg-gray-100' : 'bg-white/5'}`}>
              <div
                className="h-full rounded-full animate-barFill"
                style={{
                  backgroundColor: item.color,
                  '--bar-width': `${widthPct}%`,
                  '--bar-delay': `${idx * 0.15}s`,
                } as React.CSSProperties}
              />
            </div>
            <span className={`text-xs font-mono w-16 ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>
              {mb.toFixed(1)} MB
            </span>
          </div>
        );
      })}
      {/* 总计 */}
      <div className={`pt-3 mt-2 border-t flex justify-between text-xs font-medium ${theme === 'light' ? 'border-gray-200 text-gray-700' : 'border-white/10 text-gray-400'}`}>
        <span>总占用</span>
        <span className={theme === 'light' ? 'text-gray-900 font-bold' : 'text-white font-bold'}>{total.toFixed(1)} MB</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   组件状态面板
   ═══════════════════════════════════════════════════════════════ */

interface StatusItemProps {
  icon: React.ReactNode;
  name: string;
  status: string;
  detail: string;
}

function StatusItem({ icon, name, status, detail }: StatusItemProps) {
  const { theme } = useSystem();
  const dotColor =
    status === 'online' || status === 'available'
      ? 'bg-emerald-400'
      : status === 'standby'
        ? 'bg-blue-400'
        : status === 'loading'
          ? 'bg-amber-400'
          : 'bg-red-400';

  const ringColor =
    status === 'online' || status === 'available'
      ? 'ring-emerald-400/30'
      : status === 'standby'
        ? 'ring-blue-400/30'
        : status === 'loading'
          ? 'ring-amber-400/30'
          : 'ring-red-400/30';

  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${theme === 'light' ? 'hover:bg-gray-50' : 'hover:bg-white/5'}`}>
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 ${theme === 'light' ? 'bg-gray-100 text-gray-500' : 'bg-white/10 text-gray-400'}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${theme === 'light' ? 'text-gray-800' : 'text-gray-200'}`}>{name}</p>
        <p className={`text-xs truncate ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>{detail}</p>
      </div>
      <span className={`flex items-center gap-1.5 text-xs font-medium flex-shrink-0 ${theme === 'light' ? 'text-gray-500' : 'text-gray-400'}`}>
        <span
          className={`inline-block h-2 w-2 rounded-full ${dotColor} ring-2 ${ringColor} ${
            status === 'loading' ? 'animate-pulse' : ''
          }`}
        />
        {status === 'online' || status === 'available'
          ? '在线'
          : status === 'standby'
            ? '待命'
            : status === 'loading'
              ? '加载中'
              : '离线'}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   数据管道态势动画 — Y 型分叉布局
   ═══════════════════════════════════════════════════════════════ */

interface DataPipelineProps {
  collections: Collection[];
  graphStats: DashboardGraphStats | null;
}

function DataPipeline({ collections, graphStats }: DataPipelineProps) {
  const { theme } = useSystem();
  const totalDocs = collections.reduce((s, c) => s + c.document_count, 0);
  const totalChunks = collections.reduce((s, c) => s + c.chunk_count, 0);
  const totalEntities = graphStats?.total_entities ?? 0;
  const totalRelations = graphStats?.total_relations ?? 0;

  const lineColor = theme === 'light' ? '#4f46e5' : '#818cf8';
  const particleBaseColor = theme === 'light' ? '#4f46e5' : '#a5b4fc';
  const pipelinePaths = {
    uploadToParser: 'M 9 50 H 29',
    parserToChunk: 'M 29 50 H 43 C 48 50 48 25 53 25',
    chunkToVector: 'M 53 25 H 75',
    parserToLearning: 'M 29 50 H 43 C 48 50 48 75 53 75',
    learningToGraph: 'M 53 75 H 75',
    vectorToKnowledge: 'M 75 25 H 84 C 90 25 88 50 92 50',
    graphToKnowledge: 'M 75 75 H 84 C 90 75 88 50 92 50',
  };
  const upperParticlePath = `${pipelinePaths.uploadToParser} ${pipelinePaths.parserToChunk.replace('M 29 50', '')} ${pipelinePaths.chunkToVector.replace('M 53 25', '')} ${pipelinePaths.vectorToKnowledge.replace('M 75 25', '')}`;
  const lowerParticlePath = `${pipelinePaths.uploadToParser} ${pipelinePaths.parserToLearning.replace('M 29 50', '')} ${pipelinePaths.learningToGraph.replace('M 53 75', '')} ${pipelinePaths.graphToKnowledge.replace('M 75 75', '')}`;

  /* 管道节点定义 */
  type StageInfo = { label: string; icon: React.ReactNode; count: number };

  // 共用起点
  const startStages: StageInfo[] = [
    { label: '文档上传', icon: <FileText size={20} />, count: totalDocs },
    { label: '解析引擎', icon: <ScanText size={20} />, count: totalDocs },
  ];

  // 上分支 — 向量化路径
  const upperStages: StageInfo[] = [
    { label: '智能分块', icon: <Layers size={20} />, count: totalChunks },
    { label: '向量化', icon: <BrainCircuit size={20} />, count: totalChunks },
  ];

  // 下分支 — 图谱路径
  const lowerStages: StageInfo[] = [
    { label: '深入学习', icon: <GitBranch size={20} />, count: totalEntities },
    { label: '图谱化', icon: <Waypoints size={20} />, count: totalRelations },
  ];

  // 终点
  const endStage: StageInfo = { label: '知识库', icon: <Database size={20} />, count: totalChunks };

  /* 节点渲染 */
  const renderNode = (stage: StageInfo, idx: number) => (
    <div key={stage.label} className="flex flex-col items-center">
      <div className="relative flex h-14 w-14 items-center justify-center rounded-full theme-surface border-2 border-indigo-500/50 shadow-lg shadow-indigo-500/20 animate-breathe">
        <span className="text-indigo-400">{stage.icon}</span>
      </div>
      <span className={`mt-2 text-xs font-medium ${theme === 'light' ? 'text-gray-700' : 'text-gray-300'}`}>{stage.label}</span>
      <span className={`mt-0.5 text-lg font-bold ${theme === 'light' ? 'text-gray-800' : 'text-white'}`}>{stage.count}</span>
    </div>
  );

  return (
    <div className={`rounded-xl p-6 overflow-hidden relative ${theme === 'light' ? 'bg-white border border-gray-200 shadow-sm' : 'theme-surface border theme-border'}`}>
      <h3 className={`text-sm font-semibold mb-6 ${theme === 'light' ? 'text-gray-800' : 'text-gray-200'}`}>数据处理管道</h3>

      {/* Y型管道布局 */}
      <div className="relative">
        {/* SVG 连线 + 粒子 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ zIndex: 0 }}>
          <defs>
            <filter id="pipelineGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="0.8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {Object.entries(pipelinePaths).map(([key, path]) => (
            <path
              key={key}
              d={path}
              fill="none"
              stroke={lineColor}
              strokeWidth="0.7"
              strokeDasharray="2.4 1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-dash-flow"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {[upperParticlePath, lowerParticlePath].map((path, idx) => (
            <g key={idx} filter="url(#pipelineGlow)">
              <circle r="1" fill={idx === 0 ? particleBaseColor : '#c084fc'}>
                <animateMotion dur="4.2s" repeatCount="indefinite" path={path} rotate="auto" begin={`${idx * 0.8}s`} />
              </circle>
              <circle r="0.65" fill={idx === 0 ? '#e0e7ff' : '#f5d0fe'} opacity="0.85">
                <animateMotion dur="4.2s" repeatCount="indefinite" path={path} rotate="auto" begin={`${idx * 0.8 + 1.6}s`} />
              </circle>
            </g>
          ))}
        </svg>

        {/* 管道节点 — 三行布局 */}
        <div className="relative" style={{ zIndex: 2 }}>
          {/* 上分支行 */}
          <div className="flex items-center" style={{ height: '80px' }}>
            <div className="flex-1" />
            {upperStages.map((s, i) => (
              <div key={s.label} className="flex justify-center" style={{ width: '22%' }}>
                {renderNode(s, i)}
              </div>
            ))}
            <div style={{ width: '14%' }} />
          </div>

          {/* 中间行 — 起点 */}
          <div className="flex items-center" style={{ height: '80px' }}>
            {startStages.map((s, i) => (
              <div key={s.label} className="flex justify-center" style={{ width: i === 0 ? '18%' : '22%' }}>
                {renderNode(s, i)}
              </div>
            ))}
            <div className="flex-1" />
            {/* 终点节点 — 右侧居中 */}
            <div className="flex justify-center" style={{ width: '18%' }}>
              {renderNode(endStage, 0)}
            </div>
          </div>

          {/* 下分支行 */}
          <div className="flex items-center" style={{ height: '80px' }}>
            <div className="flex-1" />
            {lowerStages.map((s, i) => (
              <div key={s.label} className="flex justify-center" style={{ width: '22%' }}>
                {renderNode(s, i)}
              </div>
            ))}
            <div style={{ width: '14%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Dashboard 主页面
   ═══════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  const { theme } = useSystem();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [graphStats, setGraphStats] = useState<DashboardGraphStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusLoading, setStatusLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const status = await getSystemStatus();
      setSystemStatus(status);
    } catch {
      // silent — don't spam toast on every 30s refresh
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [cols, status, gStats] = await Promise.all([
        getCollections(),
        getSystemStatus(),
        getDashboardGraphStats().catch(() => null), // 优雅降级
      ]);
      setCollections(cols);
      setSystemStatus(status);
      setGraphStats(gStats);
    } catch {
      addToast('error', '获取仪表盘数据失败');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchAll();
    // 30秒自动刷新系统状态
    timerRef.current = setInterval(fetchStatus, 30000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchAll, fetchStatus]);


  /* ── 派生数据 ───────────────────────────────────────────── */
  const totalDocs = collections.reduce((s, c) => s + c.document_count, 0);
  const totalChunks = collections.reduce((s, c) => s + c.chunk_count, 0);
  const vectorDim = 1024; // BGE-M3 固定维度
  const totalEntities = graphStats?.total_entities ?? 0;
  const totalRelations = graphStats?.total_relations ?? 0;

  // 环形图数据 — 知识库文档分布
  const donutSegments = collections.map((c) => ({
    name: c.name,
    value: c.document_count,
  }));

  // 环形图数据 — 实体类型分布
  const entityTypeSegments = graphStats
    ? Object.entries(graphStats.entity_type_distribution).map(([name, value]) => ({
        name: formatEntityTypeLabel(name),
        value,
      }))
    : [];

  /* ── 加载态 ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div>
        <div className="mb-6">
          <div className={`h-8 w-40 rounded animate-pulse mb-2 ${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'}`} />
          <div className={`h-4 w-56 rounded animate-pulse ${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'}`} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className={`h-28 rounded-xl animate-pulse ${theme === 'light' ? 'bg-gray-200' : 'bg-white/10'}`} />
          ))}
        </div>
      </div>
    );
  }

  /* ── 主题辅助 ────────────────────────────────────────────── */
  const tc = (dark: string, light: string) => theme === 'light' ? light : dark;
  const surfaceCls = theme === 'light'
    ? 'bg-white border border-gray-200 shadow-sm'
    : 'bg-white/5 backdrop-blur-md border border-white/10';

  /* ── 渲染 ────────────────────────────────────────────────── */
  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={`text-2xl font-bold ${tc('text-white', 'text-gray-800')}`}>系统仪表盘</h1>
          <p className={`text-sm mt-1 ${tc('text-gray-400', 'text-gray-500')}`}>知识库系统整体运行状态</p>
        </div>
        <div className="flex items-center gap-3">
          {/* 智能客服按钮 */}
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 hover:from-emerald-500/30 hover:to-cyan-500/30 transition-all"
            title="智能问答"
          >
            <Bot size={18} className="text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">智能客服</span>
          </button>
          {/* 刷新按钮 */}
          <button
            onClick={() => { fetchAll(); }}
            className={`flex items-center gap-1.5 text-sm transition-colors ${tc('text-gray-400 hover:text-indigo-400', 'text-gray-500 hover:text-indigo-600')}`}
          >
            <RefreshCw size={14} className={statusLoading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </div>

      {/* ── 顶部区域：动态Logo + 6张统计卡片 ───────────────────── */}
      <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <MatrixLogoCard />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="知识库总数"
          value={collections.length}
          icon={<Database size={22} />}
          accent="#818cf8"
          accentSoft="rgba(99,102,241,0.34)"
          trend="全系统知识库"
          delay={0}
        />
        <StatCard
          label="文档总数"
          value={totalDocs}
          icon={<FileText size={22} />}
          accent="#a78bfa"
          accentSoft="rgba(124,58,237,0.32)"
          trend="已上传文档"
          delay={80}
        />
        <StatCard
          label="分块总数"
          value={totalChunks}
          icon={<Layers size={22} />}
          accent="#93c5fd"
          accentSoft="rgba(59,130,246,0.28)"
          trend="智能分块结果"
          delay={160}
        />
        <StatCard
          label="向量维度"
          value={vectorDim}
          icon={<Cpu size={22} />}
          accent="#c4b5fd"
          accentSoft="rgba(139,92,246,0.30)"
          trend="BGE-M3 dense"
          delay={240}
        />
        <StatCard
          label="实体总数"
          value={totalEntities}
          icon={<GitBranch size={22} />}
          accent="#60a5fa"
          accentSoft="rgba(37,99,235,0.30)"
          trend={graphStats ? '知识图谱实体' : '暂无数据'}
          delay={320}
        />
        <StatCard
          label="关系总数"
          value={totalRelations}
          icon={<Waypoints size={22} />}
          accent="#8b5cf6"
          accentSoft="rgba(79,70,229,0.34)"
          trend={graphStats ? '实体间关系' : '暂无数据'}
          delay={400}
        />
        </div>
      </div>

      {/* ── 中间区域：实体类型分布 + 磁盘占用 ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 左：实体类型分布环形图 */}
        <div className={`rounded-xl p-6 ${surfaceCls}`}>
          <h3 className={`text-sm font-semibold mb-4 ${tc('text-white', 'text-gray-800')}`}>实体类型分布</h3>
          {entityTypeSegments.length > 0 ? (
            <DonutChart segments={entityTypeSegments} centerLabel="实体总数" centerValue={totalEntities} />
          ) : (
            <div className={`flex items-center justify-center h-44 text-sm ${tc('text-gray-500', 'text-gray-500')}`}>
              暂无图谱数据
            </div>
          )}
        </div>

        {/* 右：磁盘占用可视化 */}
        <div className={`rounded-xl p-6 ${surfaceCls}`}>
          <h3 className={`text-sm font-semibold mb-4 ${tc('text-white', 'text-gray-800')}`}>磁盘占用</h3>
          <DiskUsageChart diskUsage={graphStats?.disk_usage ?? null} />
        </div>
      </div>

      {/* ── 组件运行状态 ───────────────────────────────────── */}
      <div className={`rounded-xl p-6 mb-8 ${surfaceCls}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`text-sm font-semibold ${tc('text-white', 'text-gray-800')}`}>组件运行状态</h3>
          <span className={`text-xs ${tc('text-gray-500', 'text-gray-500')}`}>每30秒自动刷新</span>
        </div>
        {systemStatus ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1">
            <StatusItem
              icon={<Server size={16} />}
              name="后端服务"
              status={systemStatus.backend.status}
              detail={`运行时间 ${systemStatus.backend.uptime}`}
            />
            <StatusItem
              icon={<BrainCircuit size={16} />}
              name="Embedding 模型"
              status={systemStatus.embedding_model.status}
              detail={`${systemStatus.embedding_model.model_name} · ${systemStatus.embedding_model.device}`}
            />
            <StatusItem
              icon={<Database size={16} />}
              name="向量数据库"
              status={systemStatus.vector_db.status}
              detail={`${systemStatus.vector_db.collections} 知识库 · ${systemStatus.vector_db.total_vectors} 向量`}
            />
            <StatusItem
              icon={<ScanText size={16} />}
              name="OCR 引擎"
              status={systemStatus.ocr_engine.status}
              detail={`引擎: ${systemStatus.ocr_engine.engine}`}
            />
            <StatusItem
              icon={<HardDrive size={16} />}
              name="元数据库"
              status={systemStatus.database.status}
              detail={`${systemStatus.database.size_mb} MB · ${systemStatus.database.path}`}
            />
          </div>
        ) : (
          <div className={`flex items-center justify-center h-44 text-sm ${tc('text-gray-500', 'text-gray-500')}`}>
            状态数据加载中…
          </div>
        )}
      </div>

      {/* ── 底部：数据管道 Y 型态势动画 ─────────────────────── */}
      <DataPipeline collections={collections} graphStats={graphStats} />
    </div>
  );
}
