import { describe, expect, it } from 'vitest';
import type { ID, Selection, TranscriptSegment } from '@veh/shared';
import {
  findCurrentSegment,
  promotionWindow,
  selectionTotals,
  selectionsForClip,
  selectionsForDay,
  shouldStopRangePlayback,
} from './selection';

function sel(partial: Partial<Selection> & { id: ID; clipId: ID; inSec: number; outSec: number }): Selection {
  return {
    text: '',
    tags: [],
    rating: 0,
    noteId: null,
    orderKey: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('promotionWindow', () => {
  it('中央なら [t-2, t+8]', () => {
    expect(promotionWindow(100, 600)).toEqual({ start: 98, end: 108 });
  });
  it('先頭付近は 0 にクランプ', () => {
    expect(promotionWindow(1, 600)).toEqual({ start: 0, end: 9 });
  });
  it('末尾付近は durationSec にクランプ', () => {
    expect(promotionWindow(597, 600)).toEqual({ start: 595, end: 600 });
  });
  it('極端に短いクリップでも out > in を保つ', () => {
    const w = promotionWindow(0, 0.05);
    expect(w.end).toBeGreaterThan(w.start);
  });
  it('窓幅をカスタムできる', () => {
    expect(promotionWindow(100, 600, 5, 5)).toEqual({ start: 95, end: 105 });
  });
});

describe('selectionsForClip', () => {
  const selections: Record<ID, Selection> = {
    a: sel({ id: 'a', clipId: 'c1', inSec: 50, outSec: 60 }),
    b: sel({ id: 'b', clipId: 'c1', inSec: 10, outSec: 20 }),
    c: sel({ id: 'c', clipId: 'c2', inSec: 5, outSec: 9 }),
    d: sel({ id: 'd', clipId: 'c1', inSec: 10, outSec: 15 }),
  };

  it('clipId で絞り、inSec 昇順(同点は outSec 昇順)', () => {
    const r = selectionsForClip(selections, 'c1');
    expect(r.map((s) => s.id)).toEqual(['d', 'b', 'a']);
  });
  it('該当なしは空配列', () => {
    expect(selectionsForClip(selections, 'zzz')).toEqual([]);
  });
});

describe('selectionsForDay', () => {
  const selections: Record<ID, Selection> = {
    a: sel({ id: 'a', clipId: 'c2', inSec: 5, outSec: 9 }),
    b: sel({ id: 'b', clipId: 'c1', inSec: 30, outSec: 40 }),
    c: sel({ id: 'c', clipId: 'c1', inSec: 10, outSec: 20 }),
  };
  it('clipIds の順序 → inSec 昇順', () => {
    const r = selectionsForDay(selections, ['c1', 'c2']);
    expect(r.map((s) => s.id)).toEqual(['c', 'b', 'a']);
  });
  it('Day に属さないクリップは除外', () => {
    const r = selectionsForDay(selections, ['c1']);
    expect(r.map((s) => s.id)).toEqual(['c', 'b']);
  });
});

describe('shouldStopRangePlayback', () => {
  it('outSec に到達したら停止', () => {
    expect(shouldStopRangePlayback(31, 31)).toBe(true);
    expect(shouldStopRangePlayback(31.5, 31)).toBe(true);
  });
  it('out 手前では停止しない', () => {
    expect(shouldStopRangePlayback(30.5, 31)).toBe(false);
  });
  it('わずかなマージンを許容(timeupdate の粒度対策)', () => {
    expect(shouldStopRangePlayback(30.99, 31)).toBe(true);
  });
});

describe('selectionTotals', () => {
  it('件数と合計尺を集計', () => {
    const list = [
      sel({ id: 'a', clipId: 'c1', inSec: 10, outSec: 20 }),
      sel({ id: 'b', clipId: 'c1', inSec: 30, outSec: 45 }),
    ];
    expect(selectionTotals(list)).toEqual({ count: 2, totalSec: 25 });
  });
  it('空は 0', () => {
    expect(selectionTotals([])).toEqual({ count: 0, totalSec: 0 });
  });
});

describe('findCurrentSegment', () => {
  const segs: TranscriptSegment[] = [
    { start: 0, end: 2, text: 'a' },
    { start: 2, end: 5, text: 'b' },
    { start: 5, end: 9, text: 'c' },
    { start: 12, end: 15, text: 'd' },
  ];

  it('区間内の時刻でそのセグメントを返す', () => {
    expect(findCurrentSegment(segs, 0)).toBe(0);
    expect(findCurrentSegment(segs, 3)).toBe(1);
    expect(findCurrentSegment(segs, 8.9)).toBe(2);
    expect(findCurrentSegment(segs, 13)).toBe(3);
  });
  it('境界は次のセグメントに属する(end は排他)', () => {
    expect(findCurrentSegment(segs, 2)).toBe(1);
    expect(findCurrentSegment(segs, 5)).toBe(2);
  });
  it('ギャップ内は -1', () => {
    expect(findCurrentSegment(segs, 10)).toBe(-1);
  });
  it('範囲外は -1', () => {
    expect(findCurrentSegment(segs, -1)).toBe(-1);
    expect(findCurrentSegment(segs, 99)).toBe(-1);
  });
  it('空配列は -1', () => {
    expect(findCurrentSegment([], 3)).toBe(-1);
  });
});
