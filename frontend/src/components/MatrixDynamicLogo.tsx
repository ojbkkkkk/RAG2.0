import type { CSSProperties } from 'react';

const CUBE_SIZE = 50;
const CUBE_STEP = 95;
const HALF = CUBE_SIZE / 2;
const LOGO_CANVAS_SIZE = CUBE_STEP * 3 + CUBE_SIZE;

const CUBE_CHARS = [
  '天', '地', '方', '圆', '金', '木', '水', '火', '土', '知',
  '识', '库', '道', '理', '文', '武', '风', '云', '雷', '电',
  '山', '海', '星', '月', '日', '光', '阴', '阳', '乾', '坤',
  '玄', '机', '数', '矩', '阵', '智', '慧', '学', '问', '思',
  '辨', '明', '暗', '虚', '实', '动', '静', '刚', '柔', '变',
  '化', '通', '达', '博', '古', '今', '中', '外', '上', '下',
];

interface CubeData {
  x: number;
  y: number;
  z: number;
  chars: string[];
  floatIdx: number;
  floatDur: number;
  floatDelay: number;
}

interface FaceDef {
  key: string;
  transform: string;
}

const FACES: FaceDef[] = [
  { key: 'front', transform: `translateZ(${HALF}px)` },
  { key: 'back', transform: `rotateY(180deg) translateZ(${HALF}px)` },
  { key: 'left', transform: `rotateY(-90deg) translateZ(${HALF}px)` },
  { key: 'right', transform: `rotateY(90deg) translateZ(${HALF}px)` },
  { key: 'top', transform: `rotateX(90deg) translateZ(${HALF}px)` },
  { key: 'bottom', transform: `rotateX(-90deg) translateZ(${HALF}px)` },
];

function seededShuffle(chars: string[]) {
  return chars
    .map((char, index) => ({ char, weight: Math.sin((index + 1) * 9301) * 10000 }))
    .sort((a, b) => (a.weight % 1) - (b.weight % 1))
    .map((item) => item.char);
}

function generateCubes(): CubeData[] {
  const cubes: CubeData[] = [];
  const shuffled = seededShuffle(CUBE_CHARS);
  let charIdx = 0;

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const chars: string[] = [];
        for (let f = 0; f < 6; f++) {
          chars.push(shuffled[charIdx % shuffled.length]);
          charIdx++;
        }
        const order = cubes.length;
        cubes.push({
          x,
          y,
          z,
          chars,
          floatIdx: order % 4,
          floatDur: 3.8 + (order % 5) * 0.22,
          floatDelay: (order % 9) * 0.18,
        });
      }
    }
  }
  return cubes;
}

const MATRIX_LOGO_CUBES = generateCubes();

interface MatrixDynamicLogoProps {
  size?: number;
  accentColor: string;
  faceBg: string;
  textColor: string;
  className?: string;
  style?: CSSProperties;
  glow?: 'normal' | 'strong' | 'subtle';
}

export default function MatrixDynamicLogo({
  size = LOGO_CANVAS_SIZE,
  accentColor,
  faceBg,
  textColor,
  className = '',
  style,
  glow = 'normal',
}: MatrixDynamicLogoProps) {
  const scale = size / LOGO_CANVAS_SIZE;
  const shadowStrength = glow === 'strong' ? '88' : glow === 'subtle' ? '38' : '55';
  const insetStrength = glow === 'strong' ? '38' : glow === 'subtle' ? '18' : '22';

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: 'relative',
        perspective: 1200,
        perspectiveOrigin: '50% 50%',
        ...style,
      }}
    >
      <style>{`
        @keyframes matrixLogoRotate {
          from { transform: rotateX(54.7deg) rotateZ(45deg) rotateY(0deg); }
          to   { transform: rotateX(54.7deg) rotateZ(45deg) rotateY(360deg); }
        }
        @keyframes matrixCubeFloat0 {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(18px, 12px, 22px); }
        }
        @keyframes matrixCubeFloat1 {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-15px, 20px, -18px); }
        }
        @keyframes matrixCubeFloat2 {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(12px, -22px, 16px); }
        }
        @keyframes matrixCubeFloat3 {
          0%, 100% { transform: translate3d(0, 0, 0); }
          50% { transform: translate3d(-20px, 15px, -12px); }
        }
      `}</style>
      <div
        style={{
          width: LOGO_CANVAS_SIZE,
          height: LOGO_CANVAS_SIZE,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: '50% 50%',
          transformStyle: 'preserve-3d',
          position: 'absolute',
          top: '50%',
          left: '50%',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            transformStyle: 'preserve-3d',
            animation: 'matrixLogoRotate 28s linear infinite',
            position: 'relative',
          }}
        >
          {MATRIX_LOGO_CUBES.map((cube, i) => {
            const transform = `translate3d(${cube.x * CUBE_STEP}px, ${cube.y * CUBE_STEP}px, ${cube.z * CUBE_STEP}px)`;

            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  marginTop: -HALF,
                  marginLeft: -HALF,
                  transformStyle: 'preserve-3d',
                  transform,
                }}
              >
                <div
                  style={{
                    transformStyle: 'preserve-3d',
                    animation: `matrixCubeFloat${cube.floatIdx} ${cube.floatDur + 1.5}s ease-in-out infinite`,
                    animationDelay: `${cube.floatDelay}s`,
                  }}
                >
                  {FACES.map((face, fi) => (
                    <div
                      key={face.key}
                      style={{
                        position: 'absolute',
                        width: CUBE_SIZE,
                        height: CUBE_SIZE,
                        transform: face.transform,
                        backfaceVisibility: 'hidden',
                        background: faceBg,
                        border: `1px solid ${accentColor}88`,
                        boxShadow: `0 0 10px ${accentColor}${shadowStrength}, inset 0 0 8px ${accentColor}${insetStrength}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '20px',
                        fontFamily: '"KaiTi", "STKaiti", "华文楷体", serif',
                        color: textColor,
                        textShadow: `0 0 8px ${textColor}`,
                      }}
                    >
                      {cube.chars[fi]}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
