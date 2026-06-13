import { describe, it, expect } from 'vitest';
import type { Clip, Selection, SourceFile } from '@veh/shared';
import { csvEscape, buildCsv } from './csv.js';

describe('csvEscape', () => {
  it('特殊文字なし → そのまま', () => {
    expect(csvEscape('hello')).toBe('hello');
  });
  it('カンマを含む → クォートで囲む', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });
  it('ダブルクォートを含む → エスケープ', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });
  it('改行を含む → クォートで囲む', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
});

function makeFile(id: string, offset: number, dur: number): SourceFile {
  return {
    id,
    path: `/mnt/c/videos/${id}.MP4`,
    fileName: `${id}.MP4`,
    sizeBytes: 1000,
    durationSec: dur,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps: 30,
    createdAt: null,
    mtime: '2024-01-01T00:00:00Z',
    startOffsetSec: offset,
    playableInBrowser: false,
  };
}

function makeClip(id: string, files: SourceFile[]): Clip {
  return {
    id,
    dayId: 'day1',
    name: `Clip ${id}`,
    cameraLabel: 'CAM A',
    files,
    durationSec: files.reduce((s, f) => s + f.durationSec, 0),
    recordedAt: '2024-01-01T10:00:00Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
  };
}

function makeSel(id: string, clipId: string, inSec: number, outSec: number, text = '', tags: string[] = []): Selection {
  return {
    id,
    clipId,
    inSec,
    outSec,
    text,
    tags,
    rating: 1,
    noteId: null,
    orderKey: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('buildCsv', () => {
  it('BOM が先頭に存在する', () => {
    const clip = makeClip('c1', [makeFile('f1', 0, 60)]);
    const sel = makeSel('s1', 'c1', 10, 20);
    const result = buildCsv([sel], id => (id === 'c1' ? clip : undefined), '2024-01-01');
    expect(result.startsWith('﻿')).toBe(true);
  });

  it('ヘッダーが正しい', () => {
    const result = buildCsv([], () => undefined, '2024-01-01');
    const lines = result.replace('﻿', '').split('\r\n');
    expect(lines[0]).toBe('day,clip,camera,in,out,duration,rating,tags,text,sourceFiles');
  });

  it('テキストにカンマがある場合はクォートで囲まれる', () => {
    const clip = makeClip('c1', [makeFile('f1', 0, 60)]);
    const sel = makeSel('s1', 'c1', 10, 20, 'text, with comma');
    const result = buildCsv([sel], id => (id === 'c1' ? clip : undefined), '2024-01-01');
    expect(result).toContain('"text, with comma"');
  });

  it('複数ファイルをまたぐ選定で両ファイル名が含まれる', () => {
    const f1 = makeFile('f1', 0, 60);
    const f2 = makeFile('f2', 60, 60);
    const clip = makeClip('c1', [f1, f2]);
    // 50秒〜70秒 → f1とf2をまたぐ
    const sel = makeSel('s1', 'c1', 50, 70);
    const result = buildCsv([sel], id => (id === 'c1' ? clip : undefined), '2024-01-01');
    expect(result).toContain('f1.MP4');
    expect(result).toContain('f2.MP4');
  });

  it('duration が正しくフォーマットされる', () => {
    const clip = makeClip('c1', [makeFile('f1', 0, 120)]);
    // 10秒〜70秒 → duration = 60秒 = 1:00
    const sel = makeSel('s1', 'c1', 10, 70);
    const result = buildCsv([sel], id => (id === 'c1' ? clip : undefined), '2024-01-01');
    expect(result).toContain('1:00');
  });
});
