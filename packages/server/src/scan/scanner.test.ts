import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isIgnoredDir, walkMediaRoot } from './scanner.js';

describe('isIgnoredDir', () => {
  it('隠し/ゴミ箱/システムフォルダを除外する(大文字小文字問わず)', () => {
    expect(isIgnoredDir('$RECYCLE.BIN')).toBe(true);
    expect(isIgnoredDir('$Recycle.Bin')).toBe(true);
    expect(isIgnoredDir('System Volume Information')).toBe(true);
    expect(isIgnoredDir('#recycle')).toBe(true);
    expect(isIgnoredDir('@Recycle')).toBe(true);
    expect(isIgnoredDir('.Trashes')).toBe(true);
    expect(isIgnoredDir('.git')).toBe(true);
    expect(isIgnoredDir('FOUND.000')).toBe(true);
  });
  it('通常のフォルダは除外しない', () => {
    expect(isIgnoredDir('Footage')).toBe(false);
    expect(isIgnoredDir('2026-04-19')).toBe(false);
    expect(isIgnoredDir('DCIM')).toBe(false);
  });
});

describe('walkMediaRoot', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('$RECYCLE.BIN 配下の削除済み素材は拾わない', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-scan-'));
    dirs.push(root);
    fs.writeFileSync(path.join(root, 'a.mp4'), '');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'b.mov'), '');
    // ゴミ箱に削除済み動画
    fs.mkdirSync(path.join(root, '$RECYCLE.BIN', 'S-1-5-21'), { recursive: true });
    fs.writeFileSync(path.join(root, '$RECYCLE.BIN', 'S-1-5-21', 'deleted.mp4'), '');
    fs.mkdirSync(path.join(root, 'System Volume Information'), { recursive: true });
    fs.writeFileSync(path.join(root, 'System Volume Information', 'x.mp4'), '');

    const found = await walkMediaRoot(root);
    const names = found.map((f) => f.fileName).sort();
    expect(names).toEqual(['a.mp4', 'b.mov']);
  });
});
