/** タイムラインのマスタークロック。映像の currentTime には従わない。 */

export interface EdlClock {
  originSec: number;
  playing: boolean;
  /** playing のとき originSec だった performance.now() */
  anchorMs: number;
  rate: number;
}

export function clockTime(clock: EdlClock, nowMs: number, durationSec: number): number {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0;
  const origin = Number.isFinite(clock.originSec) ? clock.originSec : 0;
  if (!clock.playing || dur === 0) return clamp(origin, 0, dur);
  const rate = Number.isFinite(clock.rate) && clock.rate > 0 ? clock.rate : 1;
  const elapsed = ((nowMs - clock.anchorMs) / 1000) * rate;
  return clamp(origin + elapsed, 0, dur);
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}
