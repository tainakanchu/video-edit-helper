import { describe, expect, it } from 'vitest';
import { assembleSegments } from './assemble.js';

describe('assembleSegments', () => {
  it('2ブロックのオフセットが正しく適用される', () => {
    const result = assembleSegments([
      {
        blockStartSec: 0,
        segments: [
          { startSec: 1, endSec: 3, text: 'first' },
          { startSec: 4, endSec: 6, text: 'second' },
        ],
      },
      {
        blockStartSec: 100,
        segments: [
          { startSec: 0.5, endSec: 2, text: 'third' },
        ],
      },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ start: 1, end: 3, text: 'first' });
    expect(result[1]).toEqual({ start: 4, end: 6, text: 'second' });
    expect(result[2]).toEqual({ start: 100.5, end: 102, text: 'third' });
  });

  it('空白のみのテキストセグメントは除外される', () => {
    const result = assembleSegments([
      {
        blockStartSec: 0,
        segments: [
          { startSec: 0, endSec: 1, text: '   ' },
          { startSec: 1, endSec: 2, text: '\t' },
          { startSec: 2, endSec: 3, text: 'valid' },
        ],
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('valid');
  });

  it('start 昇順にソートされる(入力が逆順でも)', () => {
    // ブロック2が先(blockStart=50)、ブロック1が後(blockStart=0)で渡す
    const result = assembleSegments([
      {
        blockStartSec: 50,
        segments: [{ startSec: 0, endSec: 1, text: 'later block' }],
      },
      {
        blockStartSec: 0,
        segments: [{ startSec: 5, endSec: 7, text: 'earlier block' }],
      },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe('earlier block'); // start=5
    expect(result[1]!.text).toBe('later block');   // start=50
  });
});
