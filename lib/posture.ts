export type Point = { x: number; y: number; visibility?: number };
export type Grade = '良好' | '注意' | '改善推奨';

export type Metrics = {
  cva: number | null;
  shoulderTilt: number;
  pelvisTilt: number;
  trunkTilt: number;
  score: number;
};

export const refs = {
  cva: {
    good: 50,
    caution: 45.5,
    label: 'CVA',
    note: '45.5°は、軽度と中等度〜重度のFHPを識別するカットオフとして報告された値。50°以上は本アプリ上の「良好」目安。',
  },
  shoulderTilt: { good: 2, caution: 5, label: '肩ライン傾斜', note: '普遍的な診断カットオフではなく、本MVPの経過観察用暫定閾値。' },
  pelvisTilt: { good: 2, caution: 5, label: '骨盤ライン傾斜', note: '普遍的な診断カットオフではなく、本MVPの経過観察用暫定閾値。' },
  trunkTilt: { good: 2, caution: 5, label: '体幹傾斜', note: '普遍的な診断カットオフではなく、本MVPの経過観察用暫定閾値。' },
};

const rad2deg = (r: number) => (r * 180) / Math.PI;

export function lineTiltDeg(a: Point, b: Point) {
  return Math.abs(rad2deg(Math.atan2(b.y - a.y, b.x - a.x)));
}

export function verticalTiltDeg(top: Point, bottom: Point) {
  const dx = top.x - bottom.x;
  const dy = bottom.y - top.y;
  return Math.abs(rad2deg(Math.atan2(dx, dy)));
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// CVA: C7から耳珠相当点への線と水平線との角度。
// MediaPipeは耳ランドマークを提供するがC7は提供しないため、C7はユーザー指定。
export function cvaDeg(c7: Point, ear: Point) {
  const dx = ear.x - c7.x;
  const dy = c7.y - ear.y; // image y is downward
  return Math.abs(rad2deg(Math.atan2(dy, dx)));
}

export function gradeCva(v: number | null): Grade {
  if (v == null) return '注意';
  if (v >= refs.cva.good) return '良好';
  if (v >= refs.cva.caution) return '注意';
  return '改善推奨';
}

export function gradeAbs(v: number, good: number, caution: number): Grade {
  if (v <= good) return '良好';
  if (v <= caution) return '注意';
  return '改善推奨';
}

export function scoreMetrics(m: Omit<Metrics, 'score'>) {
  const scores: number[] = [];
  if (m.cva != null) scores.push(Math.max(0, Math.min(100, 100 - Math.max(0, 50 - m.cva) * 6)));
  for (const [v, g, c] of [
    [m.shoulderTilt, refs.shoulderTilt.good, refs.shoulderTilt.caution],
    [m.pelvisTilt, refs.pelvisTilt.good, refs.pelvisTilt.caution],
    [m.trunkTilt, refs.trunkTilt.good, refs.trunkTilt.caution],
  ] as const) {
    scores.push(v <= g ? 100 : v <= c ? 80 - ((v - g) / (c - g)) * 30 : Math.max(20, 50 - (v - c) * 6));
  }
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
