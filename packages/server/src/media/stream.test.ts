import { describe, expect, it } from 'vitest';
import { contentTypeFor, parseRange } from './stream.js';

describe('contentTypeFor', () => {
  it('.mp4 → video/mp4', () => {
    expect(contentTypeFor('/a/b.mp4')).toBe('video/mp4');
  });
  it('.MOV → video/quicktime(大文字無視)', () => {
    expect(contentTypeFor('/a/b.MOV')).toBe('video/quicktime');
  });
  it('.m4v → video/mp4', () => {
    expect(contentTypeFor('/a/b.m4v')).toBe('video/mp4');
  });
});

describe('parseRange', () => {
  it('ヘッダ無しは null(全体配信)', () => {
    expect(parseRange(undefined, 1000)).toBeNull();
  });
  it('bytes=0-499', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });
  it('終端省略 bytes=500-', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });
  it('suffix bytes=-200', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 });
  });
  it('範囲外 start は null(416)', () => {
    expect(parseRange('bytes=1000-1500', 1000)).toBeNull();
  });
  it('start > end は null', () => {
    expect(parseRange('bytes=500-100', 1000)).toBeNull();
  });
  it('解釈不能なヘッダは null', () => {
    expect(parseRange('items=0-10', 1000)).toBeNull();
  });
});
