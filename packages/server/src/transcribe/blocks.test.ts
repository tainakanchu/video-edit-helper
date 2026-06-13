import { describe, expect, it } from 'vitest';
import { buildSpeechBlocks } from './blocks.js';

describe('buildSpeechBlocks', () => {
  it('ギャップ < 2s の隣接区間は1ブロックにマージされる', () => {
    const segments = [
      { start: 1, end: 3 },
      { start: 4, end: 6 }, // gap = 1s < 2s
    ];
    const result = buildSpeechBlocks(segments, 100, { padSec: 0 });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ start: 1, end: 6 });
  });

  it('ギャップ >= 2s の区間は2ブロックのまま残る', () => {
    const segments = [
      { start: 1, end: 3 },
      { start: 5, end: 8 }, // gap = 2s (exactly mergeGapSec, not < mergeGapSec)
    ];
    const result = buildSpeechBlocks(segments, 100, { padSec: 0 });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ start: 1, end: 3 });
    expect(result[1]).toEqual({ start: 5, end: 8 });
  });

  it('パディングが適用される(start -= 0.5, end += 0.5)', () => {
    const segments = [{ start: 5, end: 10 }];
    const result = buildSpeechBlocks(segments, 100);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ start: 4.5, end: 10.5 });
  });

  it('start が 0 未満にならないようクランプされる', () => {
    const segments = [{ start: 0.2, end: 3 }];
    const result = buildSpeechBlocks(segments, 100); // padSec=0.5 → start=−0.3 → 0
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(0);
  });

  it('end が clipDurationSec を超えないようクランプされる', () => {
    const segments = [{ start: 5, end: 9.8 }];
    const result = buildSpeechBlocks(segments, 10); // padSec=0.5 → end=10.3 → 10
    expect(result).toHaveLength(1);
    expect(result[0]!.end).toBe(10);
  });

  it('空入力は [] を返す', () => {
    expect(buildSpeechBlocks([], 100)).toEqual([]);
  });

  it('パディングで重なりが生じる場合はマージされる', () => {
    // 2つのブロックをパディングで重ねさせる
    const segments = [
      { start: 2, end: 4 },
      { start: 6, end: 8 }, // gap=2s (not merged at step1), padSec=1.5 → [0.5,5.5] [4.5,9.5] → overlap
    ];
    const result = buildSpeechBlocks(segments, 100, { mergeGapSec: 0, padSec: 1.5 });
    // [2−1.5,4+1.5]=[0.5,5.5], [6−1.5,8+1.5]=[4.5,9.5] → merged=[0.5,9.5]
    expect(result).toHaveLength(1);
    expect(result[0]!.start).toBe(0.5);
    expect(result[0]!.end).toBe(9.5);
  });
});
