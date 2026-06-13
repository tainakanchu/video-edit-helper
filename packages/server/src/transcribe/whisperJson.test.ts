import { describe, expect, it } from 'vitest';
import { parseWhisperJson, parseWhisperJsonObject } from './whisperJson.js';

/** テスト用 whisper JSON ビルダ */
function makeWhisperJson(segments: { from: number; to: number; text: string }[]): string {
  return JSON.stringify({
    transcription: segments.map((s) => ({
      offsets: { from: s.from, to: s.to },
      text: s.text,
    })),
  });
}

describe('parseWhisperJson', () => {
  it('正常な2セグメントJSONを正しくパースする', () => {
    const json = makeWhisperJson([
      { from: 0, to: 2000, text: ' Hello world' },
      { from: 3000, to: 5500, text: ' 台湾一周' },
    ]);
    const result = parseWhisperJson(json);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ startSec: 0, endSec: 2, text: 'Hello world' });
    expect(result[1]).toEqual({ startSec: 3, endSec: 5.5, text: '台湾一周' });
  });

  it('不正な JSON 文字列は [] を返す', () => {
    expect(parseWhisperJson('not json {')).toEqual([]);
  });

  it('transcription フィールドが無い場合は [] を返す', () => {
    expect(parseWhisperJson(JSON.stringify({ result: [] }))).toEqual([]);
  });

  it('offsets が欠損しているアイテムはスキップされる', () => {
    const obj = {
      transcription: [
        { text: 'no offsets' },
        { offsets: { from: 1000, to: 2000 }, text: ' valid' },
      ],
    };
    const result = parseWhisperJsonObject(obj);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('valid');
  });

  it('空白のみのテキストはスキップされる', () => {
    const obj = {
      transcription: [
        { offsets: { from: 0, to: 1000 }, text: '   ' },
        { offsets: { from: 1000, to: 2000 }, text: '\t\n' },
      ],
    };
    expect(parseWhisperJsonObject(obj)).toEqual([]);
  });

  it('from/to はミリ秒で秒に変換される', () => {
    const obj = {
      transcription: [
        { offsets: { from: 1500, to: 4250 }, text: 'timing test' },
      ],
    };
    const result = parseWhisperJsonObject(obj);
    expect(result).toHaveLength(1);
    expect(result[0]!.startSec).toBe(1.5);
    expect(result[0]!.endSec).toBe(4.25);
  });
});
