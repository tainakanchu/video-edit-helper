import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMediaPath, relPartsUnder, MountStore } from './mounts.js';

describe('relPartsUnder', () => {
  it('Windows パスの相対セグメントを取り出す(区切り正規化)', () => {
    expect(relPartsUnder('D:\\Footage\\Taiwan\\Clip.MP4', 'D:\\Footage')).toEqual([
      'Taiwan',
      'Clip.MP4',
    ]);
  });
  it('POSIX パスも扱える', () => {
    expect(relPartsUnder('/Volumes/Footage/Taiwan/clip.mp4', '/Volumes/Footage')).toEqual([
      'Taiwan',
      'clip.mp4',
    ]);
  });
  it('ルートそのものは空配列、配下でなければ null', () => {
    expect(relPartsUnder('D:\\Footage', 'D:\\Footage')).toEqual([]);
    expect(relPartsUnder('E:\\Other\\x.mp4', 'D:\\Footage')).toBeNull();
  });
});

describe('resolveMediaPath', () => {
  it('Windows で保存 → Mac で解決(接頭辞差し替え)', () => {
    const p = resolveMediaPath('D:\\Footage\\Taiwan\\Clip.MP4', ['D:\\Footage'], {
      'D:\\Footage': '/Volumes/Footage',
    });
    expect(p).toBe('/Volumes/Footage/Taiwan/Clip.MP4');
  });
  it('Mac で保存 → Windows で解決(解決は対象 OS 上で走るので join は実行環境依存)', () => {
    const p = resolveMediaPath('/Volumes/Footage/Taiwan/clip.mp4', ['/Volumes/Footage'], {
      '/Volumes/Footage': 'D:\\Footage',
    });
    expect(p).toBe(path.join('D:\\Footage', 'Taiwan', 'clip.mp4'));
  });
  it('対応表が無ければそのまま(= 同一マシンでは無変換)', () => {
    expect(resolveMediaPath('D:\\Footage\\a.mp4', ['D:\\Footage'], {})).toBe('D:\\Footage\\a.mp4');
  });
  it('どのルート配下でもなければそのまま', () => {
    expect(
      resolveMediaPath('E:\\Other\\a.mp4', ['D:\\Footage'], { 'D:\\Footage': '/Volumes/Footage' }),
    ).toBe('E:\\Other\\a.mp4');
  });
});

describe('MountStore', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function tmpFile(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-mounts-'));
    dirs.push(d);
    return path.join(d, 'mounts.json');
  }

  it('set/getAll を永続化し、clip を解決する', () => {
    const file = tmpFile();
    const m = new MountStore(file);
    m.set('D:\\Footage', '/Volumes/Footage');
    expect(m.getAll()).toEqual({ 'D:\\Footage': '/Volumes/Footage' });
    // 別インスタンスで読み直しても残っている
    expect(new MountStore(file).getAll()).toEqual({ 'D:\\Footage': '/Volumes/Footage' });

    const clip = {
      id: 'c1',
      files: [{ id: 'f1', path: 'D:\\Footage\\a.mp4' }, { id: 'f2', path: 'D:\\Footage\\b.mp4' }],
    } as unknown as import('@veh/shared').Clip;
    const resolved = m.resolveClip(clip, ['D:\\Footage']);
    expect(resolved.files.map((f) => f.path)).toEqual([
      '/Volumes/Footage/a.mp4',
      '/Volumes/Footage/b.mp4',
    ]);
  });

  it('空文字を set すると削除', () => {
    const file = tmpFile();
    const m = new MountStore(file);
    m.set('D:\\Footage', '/Volumes/Footage');
    m.set('D:\\Footage', '');
    expect(m.getAll()).toEqual({});
  });
});
