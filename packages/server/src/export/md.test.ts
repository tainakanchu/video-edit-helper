import { describe, it, expect } from 'vitest';
import type { Clip, Selection } from '@veh/shared';
import { buildMarkdown } from './md.js';

function makeClip(id: string): Clip {
  return {
    id,
    dayId: 'day1',
    name: `Clip ${id}`,
    cameraLabel: 'CAM A',
    files: [],
    durationSec: 60,
    recordedAt: '2024-01-01T10:00:00Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
  };
}

function makeSel(id: string, clipId: string, text = ''): Selection {
  return {
    id,
    clipId,
    inSec: 10,
    outSec: 20,
    text,
    tags: [],
    rating: 2,
    noteId: null,
    orderKey: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('buildMarkdown', () => {
  it('見出しが含まれる', () => {
    const result = buildMarkdown([], () => undefined, '2024-01-01');
    expect(result).toContain('# 2024-01-01 ラフカット');
  });

  it('テーブルヘッダーが含まれる', () => {
    const result = buildMarkdown([], () => undefined, '2024-01-01');
    expect(result).toContain('| clip | camera | in | out | duration | rating | tags | text |');
  });

  it('選定の行が含まれる', () => {
    const clip = makeClip('c1');
    const sel = makeSel('s1', 'c1', 'test text');
    const result = buildMarkdown([sel], id => (id === 'c1' ? clip : undefined), '2024-01-01');
    expect(result).toContain('test text');
    expect(result).toContain('Clip c1');
  });

  it('テキスト中の | がエスケープされる', () => {
    const clip = makeClip('c1');
    const sel = makeSel('s1', 'c1', 'before|after');
    const result = buildMarkdown([sel], id => (id === 'c1' ? clip : undefined), '2024-01-01');
    expect(result).toContain('before\\|after');
    // 生の | がテキスト部分に残らないことを確認（ヘッダー行は除く）
    const dataLines = result.split('\n').filter(l => l.includes('before'));
    expect(dataLines[0]).not.toContain('before|after');
  });

  it('クリップが解決できない選定はスキップ', () => {
    const sel = makeSel('s1', 'missing', 'skipped');
    const result = buildMarkdown([sel], () => undefined, '2024-01-01');
    expect(result).not.toContain('skipped');
  });
});
