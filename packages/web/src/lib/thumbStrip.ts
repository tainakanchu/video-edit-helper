/**
 * サムネイルストリップの仮想化ロジック(純関数)。
 *
 * 7 時間 × 10 秒間隔 ≒ 2,500 枚の <img> を全部描画すると重いので、
 * scrollLeft から可視範囲 ± バッファのインデックスだけを算術で求める。
 * サムネ幅は固定なので O(1) で計算できる。
 */

export interface StripGeometry {
  /** サムネ 1 枚の幅(px) */
  thumbWidth: number;
  /** 表示枠の幅(px) */
  viewportWidth: number;
  /** 現在の水平スクロール量(px) */
  scrollLeft: number;
  /** サムネ総枚数 */
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

/** 時刻(秒) → サムネインデックス(最も近い生成済みフレーム) */
export function timeToIndex(times: number[], timeSec: number): number {
  if (times.length === 0) return 0;
  // times は昇順前提。二分探索で最近傍を求める
  let lo = 0;
  let hi = times.length - 1;
  if (timeSec <= times[0]!) return 0;
  if (timeSec >= times[hi]!) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = times[mid]!;
    if (v === timeSec) return mid;
    if (v < timeSec) lo = mid + 1;
    else hi = mid - 1;
  }
  // lo は timeSec より大きい最初の要素、hi はその手前。近い方を選ぶ
  const after = times[lo] ?? times[hi]!;
  const before = times[hi] ?? times[lo]!;
  return Math.abs(after - timeSec) < Math.abs(timeSec - before) ? lo : hi;
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
