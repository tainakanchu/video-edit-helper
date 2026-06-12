import { describe, expect, it } from 'vitest';
import {
  addRange,
  coverage,
  formatTime,
  locateInFiles,
  normalizeRanges,
  rangesTotal,
  totalDuration,
  virtualTime,
  type FileSpan,
} from './time.js';

describe('normalizeRanges', () => {
  it('重なる区間をマージする', () => {
    expect(
      normalizeRanges([
        { start: 10, end: 20 },
        { start: 15, end: 30 },
      ]),
    ).toEqual([{ start: 10, end: 30 }]);
  });

  it('epsilon 以内の隣接区間をマージする', () => {
    expect(
      normalizeRanges([
        { start: 0, end: 10 },
        { start: 10.2, end: 15 },
      ]),
    ).toEqual([{ start: 0, end: 15 }]);
  });

  it('離れた区間はそのまま、順序はソートされる', () => {
    expect(
      normalizeRanges([
        { start: 50, end: 60 },
        { start: 0, end: 10 },
      ]),
    ).toEqual([
      { start: 0, end: 10 },
      { start: 50, end: 60 },
    ]);
  });

  it('不正な区間(end <= start, NaN)を捨てる', () => {
    expect(
      normalizeRanges([
        { start: 10, end: 10 },
        { start: 20, end: 5 },
        { start: NaN, end: 30 },
        { start: 1, end: 2 },
      ]),
    ).toEqual([{ start: 1, end: 2 }]);
  });

  it('負の start は 0 にクランプする', () => {
    expect(normalizeRanges([{ start: -5, end: 10 }])).toEqual([{ start: 0, end: 10 }]);
  });
});

describe('addRange / rangesTotal / coverage', () => {
  it('追加してマージできる', () => {
    const r1 = addRange([], { start: 0, end: 10 });
    const r2 = addRange(r1, { start: 30, end: 40 });
    const r3 = addRange(r2, { start: 9, end: 31 });
    expect(r3).toEqual([{ start: 0, end: 40 }]);
  });

  it('合計とカバレッジを計算できる', () => {
    const ranges = [
      { start: 0, end: 10 },
      { start: 20, end: 30 },
    ];
    expect(rangesTotal(ranges)).toBe(20);
    expect(coverage(ranges, 100)).toBeCloseTo(0.2);
    expect(coverage(ranges, 0)).toBe(0);
    expect(coverage([{ start: 0, end: 200 }], 100)).toBe(1);
  });
});

describe('locateInFiles / virtualTime', () => {
  const files: FileSpan[] = [
    { id: 'a', startOffsetSec: 0, durationSec: 100 },
    { id: 'b', startOffsetSec: 100, durationSec: 50 },
    { id: 'c', startOffsetSec: 150, durationSec: 25 },
  ];

  it('合計時間を返す', () => {
    expect(totalDuration(files)).toBe(175);
    expect(totalDuration([])).toBe(0);
  });

  it('通しタイムコードからファイルとオフセットを引ける', () => {
    expect(locateInFiles(files, 0)).toEqual({ fileId: 'a', index: 0, offsetSec: 0 });
    expect(locateInFiles(files, 99.5)).toEqual({ fileId: 'a', index: 0, offsetSec: 99.5 });
    expect(locateInFiles(files, 100)).toEqual({ fileId: 'b', index: 1, offsetSec: 0 });
    expect(locateInFiles(files, 160)).toEqual({ fileId: 'c', index: 2, offsetSec: 10 });
  });

  it('範囲外はクランプする', () => {
    expect(locateInFiles(files, -10)).toEqual({ fileId: 'a', index: 0, offsetSec: 0 });
    const end = locateInFiles(files, 9999);
    expect(end.fileId).toBe('c');
    expect(end.offsetSec).toBeLessThanOrEqual(25);
  });

  it('空配列は例外', () => {
    expect(() => locateInFiles([], 0)).toThrow();
  });

  it('逆変換(virtualTime)が一致する', () => {
    const loc = locateInFiles(files, 123.4);
    expect(virtualTime(files, loc.index, loc.offsetSec)).toBeCloseTo(123.4);
  });
});

describe('formatTime', () => {
  it('時分秒の表示', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(7325)).toBe('2:02:05');
  });
});
