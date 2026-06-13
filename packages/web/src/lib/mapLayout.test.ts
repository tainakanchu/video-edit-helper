import { describe, expect, it } from 'vitest';
import type { Clip, Day, ID } from '@veh/shared';
import {
  assignDayColors,
  buildMarkers,
  DAY_PALETTE,
  filterMarkersByDay,
  isValidGps,
  mapDays,
  markerBounds,
  type MapMarker,
} from './mapLayout';

function day(id: ID, index: number, clipIds: ID[], date = '2024-05-0' + index): Day {
  return { id, date, index, clipIds };
}

function clip(id: ID, dayId: ID, gps: { lat: number; lon: number } | null): Clip {
  return {
    id,
    dayId,
    name: 'clip-' + id,
    cameraLabel: 'cam',
    files: [],
    durationSec: 100,
    recordedAt: '2024-05-01T10:00:00Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
    gps,
  };
}

describe('assignDayColors', () => {
  it('days 順にパレットを割り当てる', () => {
    const days = [day('d1', 1, []), day('d2', 2, []), day('d3', 3, [])];
    const colors = assignDayColors(days);
    expect(colors['d1']).toBe(DAY_PALETTE[0]);
    expect(colors['d2']).toBe(DAY_PALETTE[1]);
    expect(colors['d3']).toBe(DAY_PALETTE[2]);
  });

  it('パレットを超えたら順繰りで先頭へ戻る', () => {
    const days = Array.from({ length: DAY_PALETTE.length + 2 }, (_, i) =>
      day('d' + i, i + 1, []),
    );
    const colors = assignDayColors(days);
    expect(colors['d' + DAY_PALETTE.length]).toBe(DAY_PALETTE[0]);
    expect(colors['d' + (DAY_PALETTE.length + 1)]).toBe(DAY_PALETTE[1]);
  });
});

describe('isValidGps', () => {
  it('有効な座標', () => {
    expect(isValidGps({ lat: 25.03, lon: 121.5 })).toBe(true);
    expect(isValidGps({ lat: 0, lon: 0 })).toBe(true);
  });
  it('無効な座標', () => {
    expect(isValidGps(null)).toBe(false);
    expect(isValidGps(undefined)).toBe(false);
    expect(isValidGps({ lat: 91, lon: 0 })).toBe(false);
    expect(isValidGps({ lat: 0, lon: 200 })).toBe(false);
    expect(isValidGps({ lat: NaN, lon: 0 })).toBe(false);
  });
});

describe('buildMarkers', () => {
  const days = [day('d1', 1, ['c1', 'c2']), day('d2', 2, ['c3', 'c4'])];
  const clips: Record<ID, Clip> = {
    c1: clip('c1', 'd1', { lat: 25.0, lon: 121.5 }),
    c2: clip('c2', 'd1', null), // GPS なし → 除外
    c3: clip('c3', 'd2', { lat: 24.1, lon: 120.6 }),
    c4: clip('c4', 'd2', { lat: 23.5, lon: 120.3 }),
  };

  it('GPS を持つクリップだけマーカー化し Day 色を付ける', () => {
    const markers = buildMarkers(days, clips);
    expect(markers.map((m) => m.clipId)).toEqual(['c1', 'c3', 'c4']);
    expect(markers[0]!.color).toBe(DAY_PALETTE[0]);
    expect(markers[1]!.color).toBe(DAY_PALETTE[1]);
    expect(markers[0]!.dayIndex).toBe(1);
    expect(markers[1]!.dayIndex).toBe(2);
  });

  it('GPS が無いクリップしか無ければ空', () => {
    const noGps: Record<ID, Clip> = { c2: clip('c2', 'd1', null) };
    expect(buildMarkers([day('d1', 1, ['c2'])], noGps)).toEqual([]);
  });
});

describe('filterMarkersByDay', () => {
  const markers: MapMarker[] = [
    { clipId: 'c1', dayId: 'd1', name: 'a', lat: 1, lon: 1, dayIndex: 1, color: '#fff', recordedAt: '' },
    { clipId: 'c2', dayId: 'd2', name: 'b', lat: 2, lon: 2, dayIndex: 2, color: '#000', recordedAt: '' },
  ];

  it('null なら全件', () => {
    expect(filterMarkersByDay(markers, null)).toEqual(markers);
  });
  it('指定 Day のみ残す', () => {
    const filtered = filterMarkersByDay(markers, new Set(['d2']));
    expect(filtered.map((m) => m.clipId)).toEqual(['c2']);
  });
  it('空集合なら 0 件', () => {
    expect(filterMarkersByDay(markers, new Set())).toEqual([]);
  });
});

describe('markerBounds', () => {
  it('空なら null', () => {
    expect(markerBounds([])).toBeNull();
  });
  it('最小最大の緯度経度', () => {
    const markers: MapMarker[] = [
      { clipId: 'a', dayId: 'd', name: '', lat: 25, lon: 121, dayIndex: 1, color: '', recordedAt: '' },
      { clipId: 'b', dayId: 'd', name: '', lat: 23, lon: 122, dayIndex: 1, color: '', recordedAt: '' },
      { clipId: 'c', dayId: 'd', name: '', lat: 24, lon: 120, dayIndex: 1, color: '', recordedAt: '' },
    ];
    expect(markerBounds(markers)).toEqual({
      minLat: 23,
      maxLat: 25,
      minLon: 120,
      maxLon: 122,
    });
  });
  it('単一点なら min=max', () => {
    const markers: MapMarker[] = [
      { clipId: 'a', dayId: 'd', name: '', lat: 25, lon: 121, dayIndex: 1, color: '', recordedAt: '' },
    ];
    expect(markerBounds(markers)).toEqual({ minLat: 25, maxLat: 25, minLon: 121, maxLon: 121 });
  });
});

describe('mapDays', () => {
  it('マーカーを 1 つ以上持つ Day のみ・件数付き', () => {
    const days = [day('d1', 1, ['c1']), day('d2', 2, ['c2']), day('d3', 3, ['c3'])];
    const markers: MapMarker[] = [
      { clipId: 'c1', dayId: 'd1', name: '', lat: 1, lon: 1, dayIndex: 1, color: '', recordedAt: '' },
      { clipId: 'c3a', dayId: 'd3', name: '', lat: 1, lon: 1, dayIndex: 3, color: '', recordedAt: '' },
      { clipId: 'c3b', dayId: 'd3', name: '', lat: 2, lon: 2, dayIndex: 3, color: '', recordedAt: '' },
    ];
    const result = mapDays(days, markers);
    expect(result.map((d) => d.dayId)).toEqual(['d1', 'd3']);
    expect(result.find((d) => d.dayId === 'd3')!.markerCount).toBe(2);
    expect(result[0]!.color).toBe(DAY_PALETTE[0]);
  });
});
