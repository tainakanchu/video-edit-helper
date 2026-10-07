import { describe, expect, it } from 'vitest';
import { clockTime, type EdlClock } from './edlClock';

const base: EdlClock = { originSec: 10, playing: false, anchorMs: 1000, rate: 1 };

describe('clockTime', () => {
  it('停止中は origin を尺でクランプする', () => {
    expect(clockTime(base, 5000, 100)).toBe(10);
    expect(clockTime({ ...base, originSec: -3 }, 0, 100)).toBe(0);
    expect(clockTime({ ...base, originSec: 200 }, 0, 100)).toBe(100);
  });

  it('再生中は経過に rate を掛ける', () => {
    expect(clockTime({ ...base, playing: true, rate: 2 }, 1000 + 1500, 100)).toBe(13);
  });

  it('終端で止まる', () => {
    expect(clockTime({ ...base, playing: true }, 1000 + 10_000, 12)).toBe(12);
  });

  it('尺 0 は 0', () => {
    expect(clockTime({ ...base, playing: true }, 9999, 0)).toBe(0);
  });
});
