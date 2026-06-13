/**
 * 選定(Selection)・トリアージ・文字起こしまわりの純ロジック(テスト対象)。
 * DOM 非依存。
 */

import type { ID, Selection, TimeRange, TranscriptSegment } from '@veh/shared';

/** 付箋昇格時のデフォルト窓(前 2 秒 / 後 8 秒) */
export const PROMOTE_PRE_SEC = 2;
export const PROMOTE_POST_SEC = 8;

/**
 * 付箋位置を起点にしたデフォルトのイン/アウト窓を、クリップ範囲 [0, durationSec] に
 * クランプして返す。
 */
export function promotionWindow(
  timeSec: number,
  durationSec: number,
  preSec = PROMOTE_PRE_SEC,
  postSec = PROMOTE_POST_SEC,
): TimeRange {
  const inSec = Math.max(0, timeSec - preSec);
  const outSec = Math.min(durationSec, timeSec + postSec);
  // 端でつぶれた場合でも out > in を保証(最低でも 0.1 秒)
  if (outSec <= inSec) {
    return { start: inSec, end: Math.min(durationSec, inSec + 0.1) };
  }
  return { start: inSec, end: outSec };
}

/** あるクリップの選定を inSec 昇順(同点は outSec 昇順)で返す */
export function selectionsForClip(
  selections: Record<ID, Selection>,
  clipId: ID,
): Selection[] {
  return Object.values(selections)
    .filter((s) => s.clipId === clipId)
    .sort((a, b) => a.inSec - b.inSec || a.outSec - b.outSec);
}

/** Day 全体(複数クリップ)の選定を返す。clipIds の順 → inSec 昇順 */
export function selectionsForDay(
  selections: Record<ID, Selection>,
  clipIds: ID[],
): Selection[] {
  const order = new Map(clipIds.map((id, i) => [id, i]));
  return Object.values(selections)
    .filter((s) => order.has(s.clipId))
    .sort(
      (a, b) =>
        (order.get(a.clipId)! - order.get(b.clipId)!) || a.inSec - b.inSec || a.outSec - b.outSec,
    );
}

/**
 * 範囲再生の停止判定。範囲再生中、現在時刻が outSec 以上になったら停止すべき。
 * 浮動小数の timeupdate を考慮し、わずかなマージンを許容する。
 */
export function shouldStopRangePlayback(currentSec: number, outSec: number): boolean {
  return currentSec >= outSec - 0.02;
}

/** Day 内の選定の合計数と合計尺(秒)を集計する */
export interface SelectionTotals {
  count: number;
  totalSec: number;
}

export function selectionTotals(selections: Selection[]): SelectionTotals {
  let totalSec = 0;
  for (const s of selections) {
    if (s.outSec > s.inSec) totalSec += s.outSec - s.inSec;
  }
  return { count: selections.length, totalSec };
}

/**
 * 再生中の現在セグメントのインデックスを返す。見つからなければ -1。
 * segments は start 昇順・非重複を前提に二分探索する。
 */
export function findCurrentSegment(
  segments: TranscriptSegment[],
  timeSec: number,
): number {
  let lo = 0;
  let hi = segments.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = segments[mid]!;
    if (timeSec < seg.start) {
      hi = mid - 1;
    } else if (timeSec >= seg.end) {
      lo = mid + 1;
    } else {
      result = mid;
      break;
    }
  }
  return result;
}
