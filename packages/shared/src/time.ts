import type { TimeRange } from './types.js';

const DEFAULT_EPSILON = 0.25;

/**
 * 区間リストを正規化する: 不正区間の除去 → start 昇順ソート →
 * 重なり・epsilon 以内の隣接をマージ。
 */
export function normalizeRanges(ranges: TimeRange[], epsilon = DEFAULT_EPSILON): TimeRange[] {
  const valid = ranges
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .map((r) => ({ start: Math.max(0, r.start), end: r.end }))
    .sort((a, b) => a.start - b.start);

  const merged: TimeRange[] = [];
  for (const r of valid) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + epsilon) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** 既存の正規化済みリストに区間を追加して、正規化済みリストを返す */
export function addRange(
  ranges: TimeRange[],
  range: TimeRange,
  epsilon = DEFAULT_EPSILON,
): TimeRange[] {
  return normalizeRanges([...ranges, range], epsilon);
}

/** 区間リストの合計秒数(正規化済み前提でなくてもよい) */
export function rangesTotal(ranges: TimeRange[], epsilon = DEFAULT_EPSILON): number {
  return normalizeRanges(ranges, epsilon).reduce((sum, r) => sum + (r.end - r.start), 0);
}

/** 視聴カバレッジ 0..1 */
export function coverage(
  ranges: TimeRange[],
  durationSec: number,
  epsilon = DEFAULT_EPSILON,
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.min(1, rangesTotal(ranges, epsilon) / durationSec);
}

/** 論理クリップを構成するファイルの時間スパン(SourceFile のサブセット) */
export interface FileSpan {
  id: string;
  startOffsetSec: number;
  durationSec: number;
}

export interface FileLocation {
  fileId: string;
  /** files 配列内のインデックス */
  index: number;
  /** そのファイル内のオフセット(秒) */
  offsetSec: number;
}

/** ファイル群(startOffsetSec 昇順)の合計時間 */
export function totalDuration(files: FileSpan[]): number {
  const last = files[files.length - 1];
  return last ? last.startOffsetSec + last.durationSec : 0;
}

/**
 * クリップ通しタイムコード → (ファイル, ファイル内オフセット)。
 * 範囲外は先頭/末尾にクランプする。files は startOffsetSec 昇順であること。
 */
export function locateInFiles(files: FileSpan[], timeSec: number): FileLocation {
  if (files.length === 0) {
    throw new Error('locateInFiles: files is empty');
  }
  const total = totalDuration(files);
  const t = Math.min(Math.max(0, timeSec), Math.max(0, total - 0.001));

  let index = 0;
  for (let i = files.length - 1; i >= 0; i--) {
    const f = files[i]!;
    if (t >= f.startOffsetSec) {
      index = i;
      break;
    }
  }
  const file = files[index]!;
  const offsetSec = Math.min(Math.max(0, t - file.startOffsetSec), file.durationSec);
  return { fileId: file.id, index, offsetSec };
}

/** (ファイルインデックス, ファイル内オフセット) → クリップ通しタイムコード */
export function virtualTime(files: FileSpan[], fileIndex: number, offsetSec: number): number {
  const file = files[fileIndex];
  if (!file) {
    throw new Error(`virtualTime: file index ${fileIndex} out of range`);
  }
  return file.startOffsetSec + offsetSec;
}

/** 秒 → 'H:MM:SS' / 'M:SS' 表示 */
export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
