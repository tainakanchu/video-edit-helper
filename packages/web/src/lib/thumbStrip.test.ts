import { describe, expect, it } from 'vitest';
import {
  buildSlotMap,
  computeCoverage,
  computeSlotCount,
  computeVisibleRange,
  indexToOffset,
  minIntervalCoverage,
  scrollToCenter,
  selectInterval,
  timeToSlot,
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

describe('computeSlotCount', () => {
  it('クリップ全長を interval で割った枠数(端数切り捨て+1)', () => {
    // 50分クリップ = 3000秒
    expect(computeSlotCount(3000, 60)).toBe(51);
    expect(computeSlotCount(3000, 10)).toBe(301);
  });

  it('割り切れない場合も切り捨て+1', () => {
    // 0, 60, 120 の3枠(125秒の場合)
    expect(computeSlotCount(125, 60)).toBe(3);
  });

  it('全長 0 でも最低 1 枠', () => {
    expect(computeSlotCount(0, 10)).toBe(1);
  });
});

describe('timeToSlot', () => {
  const slotCount = computeSlotCount(3000, 60); // 51

  it('interval 単位で丸めてスロットを返す', () => {
    expect(timeToSlot(0, 60, slotCount)).toBe(0);
    expect(timeToSlot(65, 60, slotCount)).toBe(1);
    expect(timeToSlot(95, 60, slotCount)).toBe(2);
  });

  it('範囲外は端にクランプする(生成済み枚数に関係なく全長ベース)', () => {
    expect(timeToSlot(-10, 60, slotCount)).toBe(0);
    expect(timeToSlot(999999, 60, slotCount)).toBe(50);
  });

  it('slotCount が 1 以下なら常に 0', () => {
    expect(timeToSlot(500, 60, 1)).toBe(0);
    expect(timeToSlot(500, 60, 0)).toBe(0);
  });
});

describe('buildSlotMap', () => {
  it('生成済み時刻をスロット index にマップする', () => {
    const map = buildSlotMap([0, 60, 120], 60, 51);
    expect(map.get(0)).toBe(0);
    expect(map.get(1)).toBe(60);
    expect(map.get(2)).toBe(120);
    expect(map.size).toBe(3);
  });

  it('同一スロットに丸まる時刻が複数あれば先勝ち', () => {
    const map = buildSlotMap([58, 61], 60, 51); // どちらも slot 1 に丸まる
    expect(map.get(1)).toBe(58);
    expect(map.size).toBe(1);
  });

  it('未生成のスロットにはエントリが無い(呼び出し側でプレースホルダ判定に使う)', () => {
    const map = buildSlotMap([0], 60, 51);
    expect(map.has(1)).toBe(false);
  });
});

describe('computeCoverage', () => {
  it('生成数 / スロット数', () => {
    expect(computeCoverage(51, 51)).toBe(1);
    expect(computeCoverage(3, 301)).toBeCloseTo(3 / 301);
  });

  it('上限は 1(超過分は丸める)', () => {
    expect(computeCoverage(400, 301)).toBe(1);
  });

  it('スロット数 0 は 0', () => {
    expect(computeCoverage(5, 0)).toBe(0);
  });
});

describe('selectInterval', () => {
  it('カバレッジ最大の interval を採用する(完了済みの粗い間隔を未完の密な間隔より優先)', () => {
    // 50分クリップ: 粗(60s)は51枚全て生成済み、密(10s)はまだ3枚だけ
    const intervals: Record<string, number[]> = {
      '60': Array.from({ length: 51 }, (_, i) => i * 60),
      '10': [0, 10, 20],
    };
    const sel = selectInterval(intervals, 3000);
    expect(sel?.intervalSec).toBe(60);
    expect(sel?.coverage).toBe(1);
    expect(sel?.times.length).toBe(51);
  });

  it('カバレッジが同率なら小さい interval(密なほう)を優先する', () => {
    const intervals: Record<string, number[]> = {
      '30': [0, 30], // slotCount=4, coverage=0.5
      '10': [0, 10, 20, 30, 40], // slotCount=10, coverage=0.5
    };
    const sel = selectInterval(intervals, 90);
    expect(sel?.intervalSec).toBe(10);
    expect(sel?.coverage).toBe(0.5);
  });

  it('生成済みが1枚も無ければ null', () => {
    expect(selectInterval({ '10': [], '60': [] }, 3000)).toBeNull();
  });

  it('intervals が空でも null', () => {
    expect(selectInterval({}, 3000)).toBeNull();
  });
});

describe('minIntervalCoverage', () => {
  it('最小 interval が未完なら 1 未満(粗い間隔が完了していても)', () => {
    const intervals: Record<string, number[]> = {
      '60': Array.from({ length: 51 }, (_, i) => i * 60), // 完了
      '10': [0, 10, 20], // 未完
    };
    expect(minIntervalCoverage(intervals, 3000)).toBeCloseTo(3 / 301);
  });

  it('最小 interval も完了していれば 1', () => {
    const intervals: Record<string, number[]> = {
      '60': Array.from({ length: 51 }, (_, i) => i * 60),
      '10': Array.from({ length: 301 }, (_, i) => i * 10),
    };
    expect(minIntervalCoverage(intervals, 3000)).toBe(1);
  });

  it('intervals が空なら 0', () => {
    expect(minIntervalCoverage({}, 100)).toBe(0);
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
