/**
 * サムネイルストリップの仮想化・スロット計算ロジック(純関数)。
 *
 * 7 時間 × 10 秒間隔 ≒ 2,500 枚の <img> を全部描画すると重いので、
 * scrollLeft から可視範囲 ± バッファのインデックスだけを算術で求める。
 * サムネ幅は固定なので O(1) で計算できる。
 *
 * 「スロット」はクリップ全長と interval だけから決まる枠の総数で、
 * 生成済みサムネの枚数には依存しない。こうすることでオーバーレイ
 * (ピン/視聴済み/選定/シーン線)が使う (t / totalSec) 座標系と
 * ストリップ自体の座標系が常に一致し、生成が部分的にしか進んでいない
 * 間もマーカー位置がずれない。未生成のスロットは呼び出し側で
 * プレースホルダとして描画する。
 */

export interface StripGeometry {
  /** サムネ 1 枚の幅(px) */
  thumbWidth: number;
  /** 表示枠の幅(px) */
  viewportWidth: number;
  /** 現在の水平スクロール量(px) */
  scrollLeft: number;
  /** スロット総数 */
  count: number;
  /** 可視範囲の前後に余分に描画する枚数 */
  buffer: number;
}

export interface VisibleRange {
  /** 描画する最初のインデックス(含む) */
  startIndex: number;
  /** 描画する最後のインデックスの次(含まない) */
  endIndex: number;
}

/** 可視範囲(±バッファ)のインデックス区間を返す。半開区間 [startIndex, endIndex) */
export function computeVisibleRange(g: StripGeometry): VisibleRange {
  const { thumbWidth, viewportWidth, scrollLeft, count, buffer } = g;
  if (count <= 0 || thumbWidth <= 0) {
    return { startIndex: 0, endIndex: 0 };
  }
  const firstVisible = Math.floor(scrollLeft / thumbWidth);
  const lastVisible = Math.floor((scrollLeft + viewportWidth) / thumbWidth);

  const startIndex = clamp(firstVisible - buffer, 0, count);
  // lastVisible は「最後に見えているインデックス」なので +1 して半開区間化
  const endIndex = clamp(lastVisible + buffer + 1, 0, count);
  return { startIndex, endIndex };
}

/** あるサムネ(index 番目)の左端 px 位置 */
export function indexToOffset(index: number, thumbWidth: number): number {
  return index * thumbWidth;
}

/** クリップ全長(秒)と interval から求まるスロット総数(全長 0 でも最低 1 枠) */
export function computeSlotCount(totalSec: number, intervalSec: number): number {
  if (intervalSec <= 0) return 1;
  return Math.floor(Math.max(0, totalSec) / intervalSec) + 1;
}

/** 時刻(秒) → スロット index。0..slotCount-1 にクランプする */
export function timeToSlot(timeSec: number, intervalSec: number, slotCount: number): number {
  if (slotCount <= 1 || intervalSec <= 0) return 0;
  const raw = Math.round(timeSec / intervalSec);
  return clamp(raw, 0, slotCount - 1);
}

/**
 * 生成済み時刻列からスロット index → 実際の生成時刻 の Map を作る。
 * 同じスロットに丸まる時刻が複数あった場合は先に現れた方(times は昇順前提)を採用する。
 */
export function buildSlotMap(
  times: number[],
  intervalSec: number,
  slotCount: number,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const t of times) {
    const slot = timeToSlot(t, intervalSec, slotCount);
    if (!map.has(slot)) map.set(slot, t);
  }
  return map;
}

/** 生成数 / スロット数 のカバレッジ(上限 1) */
export function computeCoverage(generatedCount: number, slotCount: number): number {
  if (slotCount <= 0) return 0;
  return Math.min(generatedCount / slotCount, 1);
}

export interface SelectedInterval {
  intervalSec: number;
  times: number[];
  coverage: number;
}

/**
 * マニフェストの intervals からカバレッジ最大の interval を採用する。
 * 同率の場合は小さい interval(密なほう)を優先する。
 * 生成済みが 1 枚も無い interval しか無ければ null(=未生成扱い)。
 */
export function selectInterval(
  intervals: Record<string, number[]>,
  totalSec: number,
): SelectedInterval | null {
  const keys = Object.keys(intervals)
    .map(Number)
    .filter(n => !isNaN(n) && n > 0)
    .sort((a, b) => a - b);

  let best: SelectedInterval | null = null;
  for (const intervalSec of keys) {
    const times = intervals[String(intervalSec)] ?? [];
    if (times.length === 0) continue;
    const slotCount = computeSlotCount(totalSec, intervalSec);
    const coverage = computeCoverage(times.length, slotCount);
    // keys は昇順走査なので `>` のみで更新すれば同率時に小さい interval が残る
    if (best === null || coverage > best.coverage) {
      best = { intervalSec, times, coverage };
    }
  }
  return best;
}

/**
 * マニフェスト中もっとも密な(数値が最小の) interval のカバレッジを返す。
 * これが 1 未満の間はまだ裏で生成が進んでいるとみなし、再取得を続ける目安にする。
 * interval が 1 つも無ければ 0。
 */
export function minIntervalCoverage(
  intervals: Record<string, number[]>,
  totalSec: number,
): number {
  const keys = Object.keys(intervals)
    .map(Number)
    .filter(n => !isNaN(n) && n > 0);
  if (keys.length === 0) return 0;
  const minInterval = Math.min(...keys);
  const times = intervals[String(minInterval)] ?? [];
  const slotCount = computeSlotCount(totalSec, minInterval);
  return computeCoverage(times.length, slotCount);
}

/** 現在位置のサムネを可視範囲に収めるための目標 scrollLeft */
export function scrollToCenter(
  index: number,
  thumbWidth: number,
  viewportWidth: number,
  maxScroll: number,
): number {
  const target = index * thumbWidth - viewportWidth / 2 + thumbWidth / 2;
  return clamp(target, 0, Math.max(0, maxScroll));
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
