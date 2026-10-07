/** タイムラインの時間↔ピクセル。描画とホイールズームが共有する。 */

export const EDL_MAX_PX_PER_SEC = 240;

export interface TimelineViewport {
  scrollLeft: number;
  width: number;
  pxPerSec: number;
}

export function timeToX(t: number, vp: TimelineViewport): number {
  return t * vp.pxPerSec - vp.scrollLeft;
}

export function xToTime(x: number, vp: TimelineViewport): number {
  const px = vp.pxPerSec > 0 ? vp.pxPerSec : 1;
  return (x + vp.scrollLeft) / px;
}

/** 全体が幅に収まる px/秒。尺や幅が無ければ 1 */
export function fitPxPerSec(durationSec: number, widthPx: number): number {
  if (!(durationSec > 0) || !(widthPx > 0)) return 1;
  return widthPx / durationSec;
}

/**
 * 最も引いた状態が「全体」、最も寄った状態が EDL_MAX_PX_PER_SEC。
 * 全体表示がすでに上限より大きい（極端に短い）ときは全体表示に固定する。
 */
export function clampPxPerSec(px: number, durationSec: number, widthPx: number): number {
  const fit = fitPxPerSec(durationSec, widthPx);
  const max = Math.max(fit, EDL_MAX_PX_PER_SEC);
  const n = Number.isFinite(px) ? px : fit;
  return Math.min(max, Math.max(fit, n));
}

/** カーソル下の時刻を保ったままズームする */
export function zoomAround(
  px: number,
  factor: number,
  cursorX: number,
  scrollLeft: number,
  durationSec: number,
  widthPx: number,
): { pxPerSec: number; scrollLeft: number } {
  const safePx = px > 0 ? px : 1;
  const t = (cursorX + scrollLeft) / safePx;
  const next = clampPxPerSec(safePx * factor, durationSec, widthPx);
  const maxScroll = Math.max(0, durationSec * next - widthPx);
  const nextScroll = Math.min(maxScroll, Math.max(0, t * next - cursorX));
  return { pxPerSec: next, scrollLeft: nextScroll };
}

export function visibleTimeRange(
  vp: TimelineViewport,
  overscanPx: number,
): { start: number; end: number } {
  const px = vp.pxPerSec > 0 ? vp.pxPerSec : 1;
  return {
    start: Math.max(0, (vp.scrollLeft - overscanPx) / px),
    end: (vp.scrollLeft + vp.width + overscanPx) / px,
  };
}

export function intersects(start: number, end: number, a: number, b: number): boolean {
  return end > a && start < b;
}

/**
 * photos の何枚目か。
 * gapSec が正で count*gap が尺に収まるならその秒数、否则等分。最後のコマを残り時間ホールド。
 */
export function photoIndex(
  elapsedSec: number,
  count: number,
  durSec: number,
  gapSec: number | null,
): number {
  if (count <= 1) return 0;
  const elapsed = Math.max(0, elapsedSec);
  let idx: number;
  if (gapSec !== null && gapSec > 0 && count * gapSec <= durSec + 0.05) {
    idx = Math.floor(elapsed / gapSec);
  } else {
    const slice = durSec > 0 ? durSec / count : 1;
    idx = Math.floor(elapsed / slice);
  }
  if (idx < 0) return 0;
  if (idx >= count) return count - 1;
  return idx;
}

/** t 以下で最後の章。無ければ -1 */
export function chapterIndexAt(chapters: { start: number }[], t: number): number {
  let idx = -1;
  for (let i = 0; i < chapters.length; i++) {
    const c = chapters[i];
    if (!c) break;
    if (c.start <= t + 1e-3) idx = i;
    else break;
  }
  return idx;
}
