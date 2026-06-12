import { describe, expect, it } from 'vitest';
import {
  computeVisibleRange,
  indexToOffset,
  scrollToCenter,
  timeToIndex,
} from './thumbStrip';

describe('computeVisibleRange', () => {
  const base = { thumbWidth: 160, viewportWidth: 800, count: 2500, buffer: 3 };

  it('先頭スクロールで 0 から可視+バッファ', () => {
    const r = computeVisibleRange({ ...base, scrollLeft: 0 });
    expect(r.startIndex).toBe(0);
    // 800/160 = 5 が最後の可視, +buffer 3 +1 = 9
    expect(r.endIndex).toBe(9);
  });

  it('中央付近で前後バッファ付きの窓になる', () => {
    // scrollLeft 16000 → firstVisible=100, lastVisible=105
    const r = computeVisibleRange({ ...base, scrollLeft: 16000 });
    expect(r.startIndex).toBe(97); // 100 - 3
    expect(r.endIndex).toBe(109); // 105 + 3 + 1
  });

  it('総数を超えてはみ出さない', () => {
    const r = computeVisibleRange({ ...base, scrollLeft: 2500 * 160 });
    expect(r.endIndex).toBe(2500);
    expect(r.startIndex).toBeLessThanOrEqual(2500);
  });

  it('count 0 は空窓', () => {
    const r = computeVisibleRange({ ...base, count: 0, scrollLeft: 0 });
    expect(r).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it('描画枚数は全 2500 枚よりずっと少ない(仮想化されている)', () => {
    const r = computeVisibleRange({ ...base, scrollLeft: 16000 });
    expect(r.endIndex - r.startIndex).toBeLessThan(20);
  });
});

describe('indexToOffset', () => {
  it('固定幅で算術的に求まる', () => {
    expect(indexToOffset(0, 160)).toBe(0);
    expect(indexToOffset(10, 160)).toBe(1600);
  });
});

describe('timeToIndex', () => {
  const times = [0, 10, 20, 30, 40, 50];

  it('完全一致', () => {
    expect(timeToIndex(times, 30)).toBe(3);
  });
  it('範囲外は端にクランプ', () => {
    expect(timeToIndex(times, -5)).toBe(0);
    expect(timeToIndex(times, 999)).toBe(5);
  });
  it('最近傍を選ぶ', () => {
    expect(timeToIndex(times, 12)).toBe(1); // 10 に近い
    expect(timeToIndex(times, 17)).toBe(2); // 20 に近い
    expect(timeToIndex(times, 15)).toBe(1); // 等距離は手前
  });
  it('空配列は 0', () => {
    expect(timeToIndex([], 10)).toBe(0);
  });
});

describe('scrollToCenter', () => {
  it('中央に来るようオフセットを返す', () => {
    // index10 * 160 - 800/2 + 160/2 = 1600 - 400 + 80 = 1280
    expect(scrollToCenter(10, 160, 800, 100000)).toBe(1280);
  });
  it('0 未満にならない', () => {
    expect(scrollToCenter(0, 160, 800, 100000)).toBe(0);
  });
  it('maxScroll を超えない', () => {
    expect(scrollToCenter(10000, 160, 800, 5000)).toBe(5000);
  });
});
