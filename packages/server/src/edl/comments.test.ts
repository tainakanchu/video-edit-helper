import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addComment, commentsPathFor, deleteComment, readComments } from './comments.js';

const dirs: string[] = [];

function tmpEdl(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-edl-'));
  dirs.push(dir);
  return path.join(dir, 'ep01.json');
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('comments', () => {
  it('隣の JSON に追加して消せる', () => {
    const edl = tmpEdl();
    fs.writeFileSync(edl, '{}');
    expect(commentsPathFor(edl).endsWith('ep01.comments.json')).toBe(true);
    expect(readComments(edl)).toEqual([]);
    const c = addComment(edl, { segmentId: 's1', timeSec: 1.5, text: ' メモ ' });
    expect(c.text).toBe('メモ');
    expect(c.segmentId).toBe('s1');
    const again = readComments(edl);
    expect(again).toHaveLength(1);
    expect(again[0]?.id).toBe(c.id);
    expect(deleteComment(edl, c.id)).toBe(true);
    expect(readComments(edl)).toEqual([]);
    expect(deleteComment(edl, c.id)).toBe(false);
  });

  it('空テキストは拒否し、壊れた JSON は空として読む', () => {
    const edl = tmpEdl();
    expect(() => addComment(edl, { segmentId: 's1', timeSec: 0, text: '  ' })).toThrow(/空/);
    fs.writeFileSync(commentsPathFor(edl), '{not json');
    expect(readComments(edl)).toEqual([]);
  });
});
