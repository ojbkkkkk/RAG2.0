/**
 * 印章篆刻风格 SVG 路径数据
 * 「矩陣」二字，简化篆书笔画，供逐笔动画（stroke-dashoffset）使用
 */

export interface SealStroke {
  d: string;        // SVG path data
  length: number;   // 路径总长度（用于 dashoffset 动画）
}

export interface SealCharacter {
  name: string;       // 字符名称
  viewBox: string;    // SVG viewBox
  strokes: SealStroke[]; // 笔画列表（含顺序）
}

/**
 * 「矩」— 左矢右巨，篆书简化
 *
 * 矢部：竖、横、斜撇
 * 巨部：外框（左竖、上横、右竖、下横）+ 内横
 *
 * viewBox: 0 0 200 200
 */
const ju: SealCharacter = {
  name: '矩',
  viewBox: '0 0 200 200',
  strokes: [
    // ── 矢部 ──
    {
      // 矢·主竖（左竖画）
      d: 'M 28 30 L 28 165',
      length: 135,
    },
    {
      // 矢·上横（短横画）
      d: 'M 15 44 L 72 44',
      length: 57,
    },
    {
      // 矢·斜撇（向右下斜画）
      d: 'M 28 44 L 72 138',
      length: 105,
    },

    // ── 巨部 ──
    {
      // 巨·外框左竖
      d: 'M 98 26 L 98 174',
      length: 148,
    },
    {
      // 巨·外框上横
      d: 'M 98 26 L 190 26',
      length: 92,
    },
    {
      // 巨·外框右竖
      d: 'M 190 26 L 190 174',
      length: 148,
    },
    {
      // 巨·外框下横
      d: 'M 98 174 L 190 174',
      length: 92,
    },
    {
      // 巨·内横（中横画）
      d: 'M 98 100 L 190 100',
      length: 92,
    },
  ],
};

/**
 * 「陣」— 左阝右車，篆书简化
 *
 * 阝部：左竖 + 右弧
 * 車部：中竖 + 上横 + 左右框竖 + 中横 + 下横
 *
 * viewBox: 0 0 200 200
 */
const zhen: SealCharacter = {
  name: '陣',
  viewBox: '0 0 200 200',
  strokes: [
    // ── 阝部 ──
    {
      // 阝·左竖（阜旁主竖）
      d: 'M 18 22 L 18 178',
      length: 156,
    },
    {
      // 阝·右弧（弯折画，篆书特有弧线）
      d: 'M 18 28 C 60 28 60 125 22 125',
      length: 125,
    },

    // ── 車部 ──
    {
      // 車·中竖（中心长竖）
      d: 'M 134 22 L 134 178',
      length: 156,
    },
    {
      // 車·上横（顶横画）
      d: 'M 78 28 L 190 28',
      length: 112,
    },
    {
      // 車·左框竖
      d: 'M 88 58 L 88 148',
      length: 90,
    },
    {
      // 車·右框竖
      d: 'M 180 58 L 180 148',
      length: 90,
    },
    {
      // 車·中横（中心横画）
      d: 'M 78 102 L 190 102',
      length: 112,
    },
    {
      // 車·下横（底横画）
      d: 'M 78 178 L 190 178',
      length: 112,
    },
  ],
};

/** 「矩陣」印章字符数据 */
export const sealCharacters: SealCharacter[] = [ju, zhen];
