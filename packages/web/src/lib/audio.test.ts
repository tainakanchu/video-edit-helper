import { describe, expect, it } from 'vitest';
import {
  clampGain,
  formatGainPercent,
  GAIN_STEP,
  isBoosting,
  MAX_GAIN,
  MIN_GAIN,
  nextGain,
  rmsFromBytes,
} from './audio';

describe('clampGain', () => {
  it('範囲内はそのまま', () => {
    expect(clampGain(1)).toBe(1);
    expect(clampGain(0)).toBe(0);
    expect(clampGain(2.5)).toBe(2.5);
    expect(clampGain(5)).toBe(5);
  });
  it('下限・上限でクランプ', () => {
    expect(clampGain(-1)).toBe(MIN_GAIN);
    expect(clampGain(99)).toBe(MAX_GAIN);
  });
  it('NaN / Infinity は 1 にフォールバック', () => {
    expect(clampGain(NaN)).toBe(1);
    expect(clampGain(Infinity)).toBe(1);
    expect(clampGain(-Infinity)).toBe(1);
  });
});

describe('nextGain', () => {
  it('delta を加算してクランプ', () => {
    expect(nextGain(1, GAIN_STEP)).toBeCloseTo(1.25);
    expect(nextGain(1, -GAIN_STEP)).toBeCloseTo(0.75);
  });
  it('上限を超えない', () => {
    expect(nextGain(5, GAIN_STEP)).toBe(MAX_GAIN);
    expect(nextGain(4.9, 1)).toBe(MAX_GAIN);
  });
  it('下限を下回らない', () => {
    expect(nextGain(0, -GAIN_STEP)).toBe(MIN_GAIN);
    expect(nextGain(0.1, -1)).toBe(MIN_GAIN);
  });
  it('範囲外の current も先にクランプ', () => {
    expect(nextGain(99, GAIN_STEP)).toBe(MAX_GAIN);
    expect(nextGain(-99, GAIN_STEP)).toBeCloseTo(0.25);
  });
});

describe('rmsFromBytes', () => {
  it('空入力は 0', () => {
    expect(rmsFromBytes(new Uint8Array([]))).toBe(0);
  });
  it('全サンプル 128(無音)は 0', () => {
    expect(rmsFromBytes(new Uint8Array([128, 128, 128, 128]))).toBe(0);
  });
  it('フルスケール矩形(0 と 255)は約 1', () => {
    // (0-128)/128 = -1, (255-128)/128 ≈ 0.992。RMS は約 0.996
    const v = rmsFromBytes(new Uint8Array([0, 255, 0, 255]));
    expect(v).toBeGreaterThan(0.99);
    expect(v).toBeLessThanOrEqual(1);
  });
  it('一定振幅は振幅値に一致', () => {
    // すべて (192-128)/128 = 0.5 → RMS = 0.5
    expect(rmsFromBytes(new Uint8Array([192, 192, 192]))).toBeCloseTo(0.5);
  });
  it('結果は常に 0..1 に収まる', () => {
    const v = rmsFromBytes(new Uint8Array([0, 0, 0, 0]));
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe('formatGainPercent', () => {
  it('パーセント表記', () => {
    expect(formatGainPercent(1)).toBe('100%');
    expect(formatGainPercent(2)).toBe('200%');
    expect(formatGainPercent(0)).toBe('0%');
    expect(formatGainPercent(4)).toBe('400%');
  });
  it('小数は四捨五入', () => {
    expect(formatGainPercent(1.254)).toBe('125%');
    expect(formatGainPercent(1.256)).toBe('126%');
  });
  it('範囲外もクランプして表記', () => {
    expect(formatGainPercent(99)).toBe('500%');
  });
});

describe('isBoosting', () => {
  it('1.0 以下はブーストでない', () => {
    expect(isBoosting(1)).toBe(false);
    expect(isBoosting(0.5)).toBe(false);
    expect(isBoosting(1.0009)).toBe(false);
  });
  it('1.0 超はブースト', () => {
    expect(isBoosting(1.01)).toBe(true);
    expect(isBoosting(2)).toBe(true);
    expect(isBoosting(5)).toBe(true);
  });
});
