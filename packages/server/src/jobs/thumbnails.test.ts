import { describe, expect, it } from 'vitest';
import { thumbTimes } from './thumbnails.js';

describe('thumbTimes', () => {
  it('0 から interval ごとに duration 未満まで', () => {
    expect(thumbTimes(125, 60)).toEqual([0, 60, 120]);
  });
  it('duration ちょうどは含めない', () => {
    expect(thumbTimes(120, 60)).toEqual([0, 60]);
  });
  it('interval > duration なら 0 のみ', () => {
    expect(thumbTimes(30, 60)).toEqual([0]);
  });
  it('duration 0 なら空', () => {
    expect(thumbTimes(0, 10)).toEqual([]);
  });
});
