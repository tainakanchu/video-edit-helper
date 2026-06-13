import { describe, it, expect } from 'vitest';
import { rationalTime, frameDurationString, pickTimebase } from './rational.js';

describe('rationalTime', () => {
  it('0秒は "0s"', () => {
    expect(rationalTime(0, 29.97)).toBe('0s');
  });
  it('30fps: 1.0秒 → "30/30s"', () => {
    expect(rationalTime(1.0, 30)).toBe('30/30s');
  });
  it('30fps: 0.5秒 → "15/30s"', () => {
    expect(rationalTime(0.5, 30)).toBe('15/30s');
  });
  it('29.97fps: 1.0秒 → "30030/30000s"', () => {
    // frames=round(1.0/(1001/30000))=30 → 30*1001=30030
    expect(rationalTime(1.0, 29.97)).toBe('30030/30000s');
  });
  it('25fps: 1.0秒 → "25/25s"', () => {
    expect(rationalTime(1.0, 25)).toBe('25/25s');
  });
  it('59.94fps: 1.0秒 → "60060/60000s"', () => {
    // frames=round(1.0/(1001/60000))=60 → 60*1001=60060
    expect(rationalTime(1.0, 59.94)).toBe('60060/60000s');
  });
  it('23.976fps: 1.0秒 → "24024/24000s"', () => {
    // frames=round(1.0/(1001/24000))=24 → 24*1001=24024
    expect(rationalTime(1.0, 23.976)).toBe('24024/24000s');
  });
  it('null fps: 1.0秒 → "30/30s" (30fps扱い)', () => {
    expect(rationalTime(1.0, null)).toBe('30/30s');
  });
});

describe('frameDurationString', () => {
  it('29.97fps → "1001/30000s"', () => {
    expect(frameDurationString(29.97)).toBe('1001/30000s');
  });
  it('30fps → "1/30s"', () => {
    expect(frameDurationString(30)).toBe('1/30s');
  });
  it('25fps → "1/25s"', () => {
    expect(frameDurationString(25)).toBe('1/25s');
  });
});
