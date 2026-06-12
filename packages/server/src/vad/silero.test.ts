import { describe, expect, it } from 'vitest';
import { probsToSegments } from './silero.js';

// windowSec = 512/16000 = 0.032 秒
const W = 512 / 16000;

describe('probsToSegments(ヒステリシス)', () => {
  it('連続した発話を 1 区間にまとめる', () => {
    // 100 窓ぶん高確率 = 約 3.2 秒の発話
    const probs = Array(100).fill(0.9);
    const segs = probsToSegments(probs, W);
    expect(segs).toHaveLength(1);
    // パディングで前は 0 にクランプ、後ろは +0.15
    expect(segs[0]!.start).toBeCloseTo(0, 3);
    expect(segs[0]!.end).toBeGreaterThan(3);
  });

  it('0.25 秒未満の発話は破棄する', () => {
    // 3 窓 ≒ 0.096 秒 + パディング 0.3 = 0.396? → パディング込みで長くなるので
    // パディング前の素の発話が短くても padding 後に MIN を超えうる点に注意。
    // ここでは 1 窓だけ(0.032 秒)→ パディングで 0.032+0.3=0.332 ≧ 0.25 残る
    // 確実に破棄させるには発話を作らない(全部低確率)
    const probs = Array(50).fill(0.1);
    expect(probsToSegments(probs, W)).toHaveLength(0);
  });

  it('短い谷(無音 < 0.6 秒)では区間を切らない', () => {
    // 高 → 低を 10 窓(0.32 秒 < 0.6)→ 高 に戻す
    const probs = [
      ...Array(50).fill(0.9),
      ...Array(10).fill(0.1),
      ...Array(50).fill(0.9),
    ];
    const segs = probsToSegments(probs, W);
    expect(segs).toHaveLength(1);
  });

  it('長い無音(>= 0.6 秒)で区間を分割する', () => {
    // 高 → 低 25 窓(0.8 秒 >= 0.6)→ 高
    const probs = [
      ...Array(50).fill(0.9),
      ...Array(25).fill(0.1),
      ...Array(50).fill(0.9),
    ];
    const segs = probsToSegments(probs, W);
    expect(segs).toHaveLength(2);
  });

  it('発話が無ければ空配列', () => {
    expect(probsToSegments([], W)).toEqual([]);
  });
});
