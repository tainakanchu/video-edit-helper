import { describe, it, expect } from 'vitest';
import type { Clip, Selection } from '@veh/shared';
import { orderSelections } from './order.js';

function makeClip(id: string, recordedAt: string): Clip {
  return {
    id,
    dayId: 'day1',
    name: `Clip ${id}`,
    cameraLabel: 'CAM A',
    files: [],
    durationSec: 60,
    recordedAt,
    reviewStatus: 'unreviewed',
    watchedRanges: [],
  };
}

function makeSel(id: string, clipId: string, inSec: number, orderKey: number | null = null): Selection {
  return {
    id,
    clipId,
    inSec,
    outSec: inSec + 10,
    text: '',
    tags: [],
    rating: 0,
    noteId: null,
    orderKey,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('orderSelections', () => {
  it('異なる recordedAt → 時系列順', () => {
    const clips: Record<string, Clip> = {
      c1: makeClip('c1', '2024-01-01T10:00:00Z'),
      c2: makeClip('c2', '2024-01-01T11:00:00Z'),
    };
    const sels = [makeSel('s2', 'c2', 0), makeSel('s1', 'c1', 0)];
    const result = orderSelections(sels, id => clips[id]);
    expect(result[0]!.id).toBe('s1');
    expect(result[1]!.id).toBe('s2');
  });

  it('同じ recordedAt → inSec でタイブレーク', () => {
    const clips: Record<string, Clip> = {
      c1: makeClip('c1', '2024-01-01T10:00:00Z'),
    };
    const sels = [makeSel('sb', 'c1', 20), makeSel('sa', 'c1', 10)];
    const result = orderSelections(sels, id => clips[id]);
    expect(result[0]!.id).toBe('sa');
    expect(result[1]!.id).toBe('sb');
  });

  it('orderKey が暗黙インデックスを上書きする', () => {
    const clips: Record<string, Clip> = {
      c1: makeClip('c1', '2024-01-01T10:00:00Z'),
      c2: makeClip('c2', '2024-01-01T11:00:00Z'),
      c3: makeClip('c3', '2024-01-01T12:00:00Z'),
    };
    // 時系列順: s1(c1), s2(c2), s3(c3)
    // s3 に orderKey=0 を付与 → 先頭に来るはず
    const sels = [
      makeSel('s1', 'c1', 0, null),
      makeSel('s2', 'c2', 0, null),
      makeSel('s3', 'c3', 0, 0),
    ];
    const result = orderSelections(sels, id => clips[id]);
    expect(result[0]!.id).toBe('s3');
  });

  it('クリップが解決できない選定は除外', () => {
    const clips: Record<string, Clip> = {
      c1: makeClip('c1', '2024-01-01T10:00:00Z'),
    };
    const sels = [makeSel('s1', 'c1', 0), makeSel('missing', 'cx', 0)];
    const result = orderSelections(sels, id => clips[id]);
    expect(result.length).toBe(1);
    expect(result[0]!.id).toBe('s1');
  });
});
