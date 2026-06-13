import { describe, expect, it } from 'vitest';
import { nextMarkerTime, prevMarkerTime } from './markerNav';

describe('prevMarkerTime', () => {
  const times = [10, 30, 60];

  it('現在より前の最も近い点を返す', () => {
    expect(prevMarkerTime(times, 45)).toBe(30);
    expect(prevMarkerTime(times, 31)).toBe(30);
    expect(prevMarkerTime(times, 60)).toBe(30);
  });

  it('前に点が無ければ null', () => {
    expect(prevMarkerTime(times, 10)).toBeNull();
    expect(prevMarkerTime(times, 5)).toBeNull();
    expect(prevMarkerTime([], 100)).toBeNull();
  });

  it('ほぼ点上(epsilon 内)はその点を「現在地」とみなして 1 つ前へ', () => {
    expect(prevMarkerTime(times, 30.02)).toBe(10);
  });
});

describe('nextMarkerTime', () => {
  const times = [10, 30, 60];

  it('現在より後の最も近い点を返す', () => {
    expect(nextMarkerTime(times, 5)).toBe(10);
    expect(nextMarkerTime(times, 10)).toBe(30);
    expect(nextMarkerTime(times, 45)).toBe(60);
  });

  it('後ろに点が無ければ null', () => {
    expect(nextMarkerTime(times, 60)).toBeNull();
    expect(nextMarkerTime(times, 100)).toBeNull();
    expect(nextMarkerTime([], 0)).toBeNull();
  });

  it('ほぼ点上(epsilon 内)はその点を「現在地」とみなして 1 つ先へ', () => {
    expect(nextMarkerTime(times, 29.98)).toBe(60);
  });
});
