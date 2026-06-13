import { normalizeRanges, type TimeRange } from '@veh/shared';

/** 発話ブロック化オプション */
export interface BuildSpeechBlocksOptions {
  mergeGapSec?: number; // デフォルト 2
  padSec?: number;      // デフォルト 0.5
}

/**
 * VAD の発話区間リストから whisper へ渡す「発話ブロック」を生成する純関数。
 * segments は正規化済み昇順を前提とする。
 *
 * Rules:
 * 1. 隣接区間のギャップ < mergeGapSec ならマージ
 * 2. 両端を padSec だけ広げる
 * 3. クランプ: start = max(0, start), end = min(clipDurationSec, end)
 * 4. 無効ブロック(end <= start)を除去
 * 5. パディング後に重なりが生じる場合も normalizeRanges(epsilon=0) + 再クランプ
 */
export function buildSpeechBlocks(
  segments: TimeRange[],
  clipDurationSec: number,
  opts?: BuildSpeechBlocksOptions,
): TimeRange[] {
  if (segments.length === 0) return [];

  const mergeGapSec = opts?.mergeGapSec ?? 2;
  const padSec = opts?.padSec ?? 0.5;

  // Step 1: mergeGapSec 未満のギャップをマージ
  const merged: TimeRange[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < mergeGapSec) {
      last.end = Math.max(last.end, seg.end);
    } else {
      merged.push({ ...seg });
    }
  }

  // Step 2: パディング
  const padded = merged.map((b) => ({ start: b.start - padSec, end: b.end + padSec }));

  // Step 3 & 4: クランプ + 無効除去
  const clamped = padded
    .map((b) => ({ start: Math.max(0, b.start), end: Math.min(clipDurationSec, b.end) }))
    .filter((b) => b.end > b.start);

  // Step 5: パディング後の重なりをマージ → 再クランプ
  const normalized = normalizeRanges(clamped, 0).map((b) => ({
    start: Math.max(0, b.start),
    end: Math.min(clipDurationSec, b.end),
  })).filter((b) => b.end > b.start);

  return normalized;
}
