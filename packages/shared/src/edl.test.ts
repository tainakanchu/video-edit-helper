import { describe, expect, it } from 'vitest';
import {
  dbToGain,
  findSegmentIndex,
  isTimeCovered,
  musicLinearGain,
  stepChapter,
  stepSegment,
} from './edl.js';

describe('dbToGain / musicLinearGain', () => {
  it('0dB は 1、負の dB は減衰、上限は 1、非有限は 1', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-8)).toBeCloseTo(10 ** (-8 / 20), 5);
    expect(dbToGain(100)).toBe(1);
    expect(dbToGain(Number.NaN)).toBe(1);
  });

  it('フェードとダック', () => {
    const m = { gainDb: 0, fadeIn: 2, fadeOut: 2, start: 0, end: 10, duck: true };
    expect(musicLinearGain(m, -1, false)).toBe(0);
    expect(musicLinearGain(m, 10, false)).toBe(0);
    expect(musicLinearGain(m, 5, false)).toBe(1);
    expect(musicLinearGain(m, 1, false)).toBeCloseTo(0.5, 5);
    expect(musicLinearGain(m, 9.5, false)).toBeCloseTo(0.25, 5);
    expect(musicLinearGain(m, 5, true)).toBeCloseTo(0.25, 5);
    expect(musicLinearGain({ ...m, duck: false }, 5, true)).toBe(1);
  });
});

const segs = [
  { start: 0, dur: 10 },
  { start: 10, dur: 5 },
  { start: 20, dur: 5 },
];

describe('findSegmentIndex', () => {
  it('半開区間・隙間・最終終端', () => {
    expect(findSegmentIndex(segs, 0)).toBe(0);
    expect(findSegmentIndex(segs, 9.9)).toBe(0);
    expect(findSegmentIndex(segs, 10)).toBe(1);
    expect(findSegmentIndex(segs, 14.9)).toBe(1);
    expect(findSegmentIndex(segs, 16)).toBe(-1);
    expect(findSegmentIndex(segs, 20)).toBe(2);
    expect(findSegmentIndex(segs, 25)).toBe(2);
    expect(findSegmentIndex(segs, 25.0005)).toBe(2);
    expect(findSegmentIndex(segs, 26)).toBe(-1);
    expect(findSegmentIndex(segs, -1)).toBe(-1);
    expect(findSegmentIndex([], 0)).toBe(-1);
  });
});

describe('stepSegment / stepChapter', () => {
  it('区間を進む・戻る', () => {
    expect(stepSegment(segs, 5, 1)).toBe(10);
    expect(stepSegment(segs, 12, 1)).toBe(20);
    expect(stepSegment(segs, 22, 1)).toBe(25);
    expect(stepSegment(segs, 5, -1)).toBe(0);
    expect(stepSegment(segs, 0.1, -1)).toBe(0);
    expect(stepSegment(segs, 12, -1)).toBe(10);
    expect(stepSegment(segs, 10.1, -1)).toBe(0);
    expect(stepSegment(segs, 16, -1)).toBe(10);
  });

  it('章を進む・戻る', () => {
    const chapters = [{ start: 0 }, { start: 10 }, { start: 20 }];
    expect(stepChapter(chapters, 5, 1)).toBe(10);
    expect(stepChapter(chapters, 10, 1)).toBe(20);
    expect(stepChapter(chapters, 25, 1)).toBe(20);
    expect(stepChapter(chapters, 5, -1)).toBe(0);
    expect(stepChapter(chapters, 10, -1)).toBe(0);
    expect(stepChapter(chapters, 0, -1)).toBe(0);
    expect(stepChapter([], 4, 1)).toBe(4);
  });
});

describe('isTimeCovered', () => {
  it('半開区間で重なりを判定する', () => {
    const ranges = [
      { start: 1, end: 2 },
      { start: 5, end: 8 },
    ];
    expect(isTimeCovered(ranges, 1)).toBe(true);
    expect(isTimeCovered(ranges, 2)).toBe(false);
    expect(isTimeCovered(ranges, 6)).toBe(true);
    expect(isTimeCovered(ranges, 0)).toBe(false);
  });
});
