import { describe, expect, it } from 'vitest';
import type { Day } from '@veh/shared';
import { adjacentClipIds } from './clipNav';

function day(id: string, index: number, clipIds: string[]): Day {
  return { id, date: id, index, clipIds };
}

describe('adjacentClipIds', () => {
  const days: Day[] = [
    day('day-1', 1, ['c1', 'c2', 'c3']),
    day('day-2', 2, ['c4', 'c5']),
  ];

  it('同一 Day 内では前後のクリップを返す', () => {
    expect(adjacentClipIds(days, 'c2')).toEqual({ prevId: 'c1', nextId: 'c3' });
  });

  it('Day の最後の次は次の Day の先頭(Day 境界をまたぐ)', () => {
    expect(adjacentClipIds(days, 'c3')).toEqual({ prevId: 'c2', nextId: 'c4' });
  });

  it('Day の先頭の前は前の Day の最後(Day 境界をまたぐ)', () => {
    expect(adjacentClipIds(days, 'c4')).toEqual({ prevId: 'c3', nextId: 'c5' });
  });

  it('全体の先頭では prevId が null(ラップしない)', () => {
    expect(adjacentClipIds(days, 'c1')).toEqual({ prevId: null, nextId: 'c2' });
  });

  it('全体の末尾では nextId が null(ラップしない)', () => {
    expect(adjacentClipIds(days, 'c5')).toEqual({ prevId: 'c4', nextId: null });
  });

  it('存在しない ID は前後とも null', () => {
    expect(adjacentClipIds(days, 'unknown')).toEqual({ prevId: null, nextId: null });
  });

  it('Day が空配列なら前後とも null', () => {
    expect(adjacentClipIds([], 'c1')).toEqual({ prevId: null, nextId: null });
  });
});
