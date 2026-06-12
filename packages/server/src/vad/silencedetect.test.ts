import { describe, expect, it } from 'vitest';
import { parseSilenceDetect } from './silencedetect.js';

describe('parseSilenceDetect', () => {
  it('無音区間を発話区間に反転する', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 5.0',
      '[silencedetect @ 0x1] silence_end: 10.0 | silence_duration: 5.0',
      '[silencedetect @ 0x1] silence_start: 20.0',
      '[silencedetect @ 0x1] silence_end: 25.0 | silence_duration: 5.0',
    ].join('\n');
    // duration=30: 発話 = [0,5] [10,20] [25,30]
    expect(parseSilenceDetect(stderr, 30)).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 20 },
      { start: 25, end: 30 },
    ]);
  });

  it('冒頭から無音だと最初の発話は無音終了後から始まる', () => {
    const stderr = [
      '[silencedetect @ 0x1] silence_start: 0',
      '[silencedetect @ 0x1] silence_end: 3.5 | silence_duration: 3.5',
    ].join('\n');
    // duration=10: 発話 = [3.5,10]
    expect(parseSilenceDetect(stderr, 10)).toEqual([{ start: 3.5, end: 10 }]);
  });

  it('末尾が無音で終わる(silence_end 無し)場合は duration まで無音', () => {
    const stderr = ['[silencedetect @ 0x1] silence_start: 8.0'].join('\n');
    // duration=10: 発話 = [0,8]
    expect(parseSilenceDetect(stderr, 10)).toEqual([{ start: 0, end: 8 }]);
  });

  it('無音が一切無ければ全区間が発話', () => {
    expect(parseSilenceDetect('', 10)).toEqual([{ start: 0, end: 10 }]);
  });
});
