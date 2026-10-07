import { describe, expect, it } from 'vitest';
import {
  chapterIndexAt,
  clampPxPerSec,
  fitPxPerSec,
  intersects,
  photoIndex,
  visibleTimeRange,
  zoomAround,
} from './edlLayout';

describe('edlLayout', () => {
  it('全体表示とクランプ', () => {
    expect(fitPxPerSec(100, 200)).toBe(2);
    expect(fitPxPerSec(0, 200)).toBe(1);
    expect(clampPxPerSec(0.1, 100, 100)).toBe(1);
    expect(clampPxPerSec(10, 100, 100)).toBe(10);
    expect(clampPxPerSec(10_000, 100, 100)).toBe(240);
    expect(clampPxPerSec(10, 1, 1000)).toBe(1000);
  });

  it('ズームしてもカーソル下の時刻が動かない', () => {
    const before = zoomAround(10, 2, 40, 100, 500, 200);
    const t = (40 + 100) / 10;
    expect((40 + before.scrollLeft) / before.pxPerSec).toBeCloseTo(t, 5);
  });

  it('可視範囲と交差', () => {
    const r = visibleTimeRange({ scrollLeft: 100, width: 50, pxPerSec: 10 }, 20);
    expect(r.start).toBe(8);
    expect(r.end).toBe(17);
    expect(intersects(0, 10, 9, 12)).toBe(true);
    expect(intersects(0, 10, 10, 12)).toBe(false);
  });

  it('photoIndex は等分と gap', () => {
    expect(photoIndex(0, 3, 6, null)).toBe(0);
    expect(photoIndex(2.5, 3, 6, null)).toBe(1);
    expect(photoIndex(5.9, 3, 6, null)).toBe(2);
    expect(photoIndex(100, 3, 6, null)).toBe(2);
    expect(photoIndex(1.6, 3, 5.5, 0.8)).toBe(2);
    expect(photoIndex(0.7, 3, 5.5, 0.8)).toBe(0);
  });

  it('章インデックス', () => {
    const chapters = [{ start: 0 }, { start: 10 }, { start: 20 }];
    expect(chapterIndexAt(chapters, 0)).toBe(0);
    expect(chapterIndexAt(chapters, 15)).toBe(1);
    expect(chapterIndexAt(chapters, 20)).toBe(2);
    expect(chapterIndexAt([], 1)).toBe(-1);
  });
});
