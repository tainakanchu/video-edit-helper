import { describe, expect, it } from 'vitest';
import type { Note, Selection, TranscriptSegment } from '@veh/shared';
import { searchAll, type SearchInputs } from './matcher.js';

/** テスト用 Note ファクトリ */
function makeNote(overrides: Partial<Note> & { clipId: string }): Note {
  return {
    id: 'note-1',
    timeSec: 10,
    text: '',
    tags: [],
    status: 'open',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** テスト用 Selection ファクトリ */
function makeSelection(overrides: Partial<Selection> & { clipId: string }): Selection {
  return {
    id: 'sel-1',
    inSec: 5,
    outSec: 15,
    text: '',
    tags: [],
    rating: 0,
    noteId: null,
    orderKey: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** 常に同じメタを返すシンプルなリゾルバ */
const defaultMeta = (clipId: string) => ({ dayId: 'day-1', clipName: clipId });

describe('searchAll', () => {
  it('大文字小文字を区別しない検索(hello で Hello World にマッチ)', () => {
    const inputs: SearchInputs = {
      query: 'hello',
      notes: [makeNote({ clipId: 'clip-1', text: 'Hello World' })],
      selections: [],
      transcripts: [],
      clipMeta: defaultMeta,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Hello World');
  });

  it('タグのみマッチする Note が返る(本文はマッチしない)', () => {
    const inputs: SearchInputs = {
      query: 'sunset',
      notes: [makeNote({ clipId: 'clip-1', text: 'irrelevant text', tags: ['sunset', 'beach'] })],
      selections: [],
      transcripts: [],
      clipMeta: defaultMeta,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('note');
  });

  it('Selection のテキストマッチで inSec が timeSec、outSec が endSec になる', () => {
    const inputs: SearchInputs = {
      query: 'scenery',
      notes: [],
      selections: [makeSelection({ clipId: 'clip-1', text: 'beautiful scenery', inSec: 20, outSec: 45 })],
      transcripts: [],
      clipMeta: defaultMeta,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('selection');
    expect(result[0]!.timeSec).toBe(20);
    expect(result[0]!.endSec).toBe(45);
  });

  it('Transcript セグメントのテキストマッチ', () => {
    const segments: TranscriptSegment[] = [
      { start: 3, end: 6, text: '台湾は素晴らしい' },
      { start: 10, end: 14, text: 'cycling is fun' },
    ];
    const inputs: SearchInputs = {
      query: '台湾',
      notes: [],
      selections: [],
      transcripts: [{ clipId: 'clip-1', segments }],
      clipMeta: defaultMeta,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('transcript');
    expect(result[0]!.timeSec).toBe(3);
    expect(result[0]!.endSec).toBe(6);
  });

  it('clipMeta が undefined を返す clipId の結果はスキップされる', () => {
    const inputs: SearchInputs = {
      query: 'test',
      notes: [makeNote({ clipId: 'unknown-clip', text: 'test content' })],
      selections: [],
      transcripts: [],
      clipMeta: (_clipId) => undefined,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(0);
  });

  it('ソート順: dayId → clipName → timeSec 昇順', () => {
    const clipMeta = (clipId: string) => {
      const map: Record<string, { dayId: string; clipName: string }> = {
        'clip-a': { dayId: 'day-2', clipName: 'clip-a' },
        'clip-b': { dayId: 'day-1', clipName: 'clip-z' },
        'clip-c': { dayId: 'day-1', clipName: 'clip-a' },
        'clip-d': { dayId: 'day-1', clipName: 'clip-a' },
      };
      return map[clipId];
    };
    const inputs: SearchInputs = {
      query: 'match',
      notes: [
        makeNote({ id: 'n1', clipId: 'clip-a', text: 'match', timeSec: 1 }),
        makeNote({ id: 'n2', clipId: 'clip-b', text: 'match', timeSec: 5 }),
        makeNote({ id: 'n3', clipId: 'clip-c', text: 'match', timeSec: 20 }),
        makeNote({ id: 'n4', clipId: 'clip-d', text: 'match', timeSec: 10 }),
      ],
      selections: [],
      transcripts: [],
      clipMeta,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(4);
    // day-1/clip-a/10 < day-1/clip-a/20 < day-1/clip-z/5 < day-2/clip-a/1
    expect(result[0]!.timeSec).toBe(10);  // day-1, clip-a, t=10
    expect(result[1]!.timeSec).toBe(20);  // day-1, clip-a, t=20
    expect(result[2]!.clipName).toBe('clip-z'); // day-1, clip-z
    expect(result[3]!.dayId).toBe('day-2');
  });

  it('100件上限: 150件マッチしても100件のみ返る', () => {
    const notes: Note[] = Array.from({ length: 150 }, (_, i) =>
      makeNote({ id: `n-${i}`, clipId: 'clip-1', text: 'match this', timeSec: i }),
    );
    const inputs: SearchInputs = {
      query: 'match',
      notes,
      selections: [],
      transcripts: [],
      clipMeta: defaultMeta,
    };
    const result = searchAll(inputs);
    expect(result).toHaveLength(100);
  });

  it('空クエリは [] を返す', () => {
    const inputs: SearchInputs = {
      query: '',
      notes: [makeNote({ clipId: 'clip-1', text: 'some text' })],
      selections: [],
      transcripts: [],
      clipMeta: defaultMeta,
    };
    expect(searchAll(inputs)).toEqual([]);
  });

  it('空白のみのクエリも [] を返す', () => {
    const inputs: SearchInputs = {
      query: '   ',
      notes: [makeNote({ clipId: 'clip-1', text: 'some text' })],
      selections: [],
      transcripts: [],
      clipMeta: defaultMeta,
    };
    expect(searchAll(inputs)).toEqual([]);
  });
});
