import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSystem } from '../App';
import MatrixDynamicLogo from '../components/MatrixDynamicLogo';

// ── 字符雨配置 ──────────────────────────────────────────────

const RAIN_CHARS = [
  '亻', '氵', '木', '火', '土', '金', '石', '矢', '禾', '竹', '糸', '虫',
  '知', '识', '矩', '阵', '数', '据', '图', '谱',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

interface RainDrop {
  x: number;
  y: number;
  z: number;       // 深度 0~1，1最近
  speed: number;
  char: string;
  charTimer: number;
  charInterval: number;
}

function randomChar() {
  return RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)];
}

function createDrop(canvasW: number, canvasH: number): RainDrop {
  const z = 0.1 + Math.random() * 0.9;
  return {
    x: Math.random() * canvasW,
    y: Math.random() * canvasH - canvasH,
    z,
    speed: 0.4 + z * 2.2,
    char: randomChar(),
    charTimer: 0,
    charInterval: 20 + Math.floor(Math.random() * 40),
  };
}

// ── 3D 魔方配置 ──────────────────────────────────────────────
// ── 主组件 ─────────────────────────────────────────────────

export default function Welcome() {
  const { theme } = useSystem();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const dropsRef = useRef<RainDrop[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const enteringRef = useRef(false);

  const [cubeVisible, setCubeVisible] = useState(false);

  // 按钮/页面状态
  const [showButton, setShowButton] = useState(false);
  const [pageOut, setPageOut] = useState(false);

  // 主题颜色
  const isDark = theme === 'dark';
  const bgColor = isDark ? '#050a0f' : '#f0f4f8';
  const accentColor = isDark ? '#00e5ff' : '#005580';
  const cubeFaceBg = isDark ? 'rgba(0,20,30,0.8)' : 'rgba(220,240,250,0.9)';
  const cubeTextColor = isDark ? '#00ffd5' : '#003355';
  const titleColor = isDark ? '#00ffd5' : '#005580';

  // ── Canvas 字符雨 ─────────────────────────────────────────

  const initDrops = useCallback((w: number, h: number) => {
    const count = Math.floor((w * h) / 5000);
    dropsRef.current = Array.from({ length: count }, () => createDrop(w, h));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initDrops(canvas.width, canvas.height);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const W = canvas.width;
      const H = canvas.height;
      const mx = mouseRef.current.x / W - 0.5;
      const my = mouseRef.current.y / H - 0.5;

      ctx.fillStyle = isDark
        ? 'rgba(5, 10, 15, 0.18)'
        : 'rgba(240, 244, 248, 0.20)';
      ctx.fillRect(0, 0, W, H);

      for (const d of dropsRef.current) {
        const px = d.x + mx * d.z * 30;
        const py = d.y + my * d.z * 20;

        const size = 8 + d.z * 18;
        const alpha = 0.15 + d.z * 0.85;

        ctx.font = `${size}px monospace`;
        ctx.fillStyle = isDark
          ? `rgba(0, 255, 213, ${alpha})`
          : `rgba(0, 85, 128, ${alpha})`;
        ctx.fillText(d.char, px, py);

        d.y += d.speed;
        d.charTimer++;
        if (d.charTimer >= d.charInterval) {
          d.char = randomChar();
          d.charTimer = 0;
        }

        if (d.y > H + 30) {
          d.y = -30;
          d.x = Math.random() * W;
          d.z = 0.1 + Math.random() * 0.9;
          d.speed = 0.4 + d.z * 2.2;
        }
      }
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [isDark, initDrops]);

  // 鼠标视差
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  // ── 魔方入场 ────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => setCubeVisible(true), 200);
    return () => clearTimeout(t);
  }, []);

  // ── 按钮出现 ──────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(() => setShowButton(true), 300);
    return () => clearTimeout(t);
  }, []);

  const handleEnter = useCallback(() => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    setPageOut(true);
    sessionStorage.setItem('rag-welcome-shown', 'true');
    setTimeout(() => navigate('/dashboard'), 600);
  }, [navigate]);

  // ── 渲染 ────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden select-none"
      style={{
        background: bgColor,
        opacity: pageOut ? 0 : 1,
        transition: 'opacity 0.52s ease',
        cursor: 'pointer',
      }}
      onClick={handleEnter}
    >
      {/* CSS Keyframes */}
      <style>{`
        @keyframes titleGlow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
      `}</style>

      {/* Canvas 字符雨 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ opacity: 0.85 }}
      />

      {/* 中央内容区域：魔方 + 标题，垂直居中偏上 */}
      <div
        className="relative z-10 flex flex-col items-center"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -55%)',
        }}
      >
        {/* 3D矩阵动态Logo容器 */}
        <div style={{
          opacity: cubeVisible ? 1 : 0,
          transform: cubeVisible ? 'scale(1)' : 'scale(0.3)',
          transition: 'opacity 1s ease-out, transform 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}>
          <MatrixDynamicLogo
            accentColor={accentColor}
            faceBg={cubeFaceBg}
            textColor={cubeTextColor}
            glow="strong"
          />
        </div>

        {/* 间距 */}
        <div style={{ height: '2.5rem' }} />

        {/* 系统名称大标题 */}
        <div
          style={{
            opacity: cubeVisible ? 1 : 0,
            transition: 'opacity 1.2s ease 1s',
            fontFamily: "'Microsoft YaHei', '\u5fae\u8f6f\u96c5\u9ed1', sans-serif",
            fontSize: '2.6rem',
            fontWeight: 700,
            letterSpacing: '0.35em',
            color: titleColor,
            textShadow: isDark
              ? `0 0 10px #00ffd5, 0 0 25px #00ffd5aa, 0 0 50px #00ffd566, 0 0 80px #00ffd533`
              : `0 0 8px #005580, 0 0 20px #00558066`,
            animation: 'titleGlow 3s ease-in-out infinite',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          矩阵-知识库管理系统
        </div>
      </div>

      {/* 进入系统按钮 —— absolute 定位在底部 */}
      <button
        onClick={(e) => { e.stopPropagation(); handleEnter(); }}
        style={{
          position: 'absolute',
          bottom: '10%',
          left: '50%',
          transform: showButton ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(16px)',
          opacity: showButton ? 1 : 0,
          pointerEvents: showButton ? 'auto' : 'none',
          zIndex: 20,
          border: `1px solid ${accentColor}`,
          color: accentColor,
          background: 'transparent',
          padding: '12px 44px',
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: '0.95rem',
          letterSpacing: '0.3em',
          cursor: 'pointer',
          borderRadius: 2,
          boxShadow: `0 0 16px ${accentColor}55`,
          transition: 'opacity 0.5s ease, transform 0.5s ease, background 0.3s ease, box-shadow 0.3s ease',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = `${accentColor}22`;
          (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 28px ${accentColor}99`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
          (e.currentTarget as HTMLButtonElement).style.boxShadow = `0 0 16px ${accentColor}55`;
        }}
      >
        ▶ 进入系统
      </button>

      {/* 版本角标 */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 28,
          fontFamily: 'monospace',
          fontSize: '0.7rem',
          color: isDark ? 'rgba(0,255,213,0.35)' : 'rgba(0,85,128,0.4)',
          letterSpacing: '0.15em',
          zIndex: 20,
        }}
      >
        MATRIX · KB · SYSTEM
      </div>
    </div>
  );
}
