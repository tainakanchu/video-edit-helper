import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isIgnoredDir, resolveScanRoots, walkMediaRoot } from './scanner.js';

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

describe('resolveScanRoots(mounts 対応表によるルート解決)', () => {
  it('対応表が無ければ保存形ルートをそのまま実在確認する', () => {
    const result = resolveScanRoots(['/media/footage'], {}, {
      platform: 'darwin',
      exists: (p) => p === '/media/footage',
    });
    expect(result.resolvedRoots).toEqual(['/media/footage']);
    expect(result.scannedRoots).toEqual(['/media/footage']);
    expect(result.missingRoots).toEqual([]);
  });

  it('対応表があれば保存形ルート(D:\\...)をこのマシンのマウント先へ変換して解決する', () => {
    const root = 'D:\\movie raw\\環島';
    const mounted = '/Volumes/COLDLINE/movie raw/環島';
    const result = resolveScanRoots([root], { [root]: mounted }, {
      platform: 'darwin',
      exists: (p) => p === mounted,
    });
    expect(result.resolvedRoots).toEqual([mounted]);
    // scannedRoots は保存形(project.json の mediaRoots と同じ表記)のまま返す
    expect(result.scannedRoots).toEqual([root]);
    expect(result.missingRoots).toEqual([]);
  });

  it('対応表のマウント先が実在しなければ missingRoots に入る(保存形のまま)', () => {
    const root = 'D:\\movie raw\\環島';
    const mounted = '/Volumes/COLDLINE/movie raw/環島';
    const result = resolveScanRoots([root], { [root]: mounted }, {
      platform: 'darwin',
      exists: () => false,
    });
    expect(result.resolvedRoots).toEqual([]);
    expect(result.scannedRoots).toEqual([]);
    expect(result.missingRoots).toEqual([root]);
  });

  it('複数ルートのうち一部だけ解決できる場合は resolved/missing に分けて返す', () => {
    const ok = '/media/ok';
    const ng = '/media/ng';
    const result = resolveScanRoots([ok, ng], {}, {
      platform: 'darwin',
      exists: (p) => p === ok,
    });
    expect(result.resolvedRoots).toEqual([ok]);
    expect(result.scannedRoots).toEqual([ok]);
    expect(result.missingRoots).toEqual([ng]);
  });
});

describe('storedRoot の伝播(実パス root ↔ 保存形 root の添字対応)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it('resolveScanRoots の resolvedRoots/scannedRoots は添字が対応し、各 root の走査結果へ保存形を付与できる', async () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-scan-rootA-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-scan-rootB-'));
    dirs.push(rootA, rootB);
    fs.writeFileSync(path.join(rootA, 'a.mp4'), '');
    fs.mkdirSync(path.join(rootB, 'sub'));
    fs.writeFileSync(path.join(rootB, 'sub', 'b.mov'), '');

    // 保存形ルート(project.json 上の表記)は実パスと異なりうる想定で、
    // mounts 対応表を介して rootA/rootB(実パス)へ解決させる
    const storedA = 'D:\\footage\\camA';
    const storedB = 'D:\\footage\\camB';
    const { resolvedRoots, scannedRoots } = resolveScanRoots(
      [storedA, storedB],
      { [storedA]: rootA, [storedB]: rootB },
      { platform: 'darwin', exists: (p) => p === rootA || p === rootB },
    );
    expect(resolvedRoots).toEqual([rootA, rootB]);
    expect(scannedRoots).toEqual([storedA, storedB]);

    // scanMediaRoots 内の走査ループと同じく、resolvedRoots/scannedRoots の添字対応で
    // storedRoot(保存形ルート)を各ファイルへ付与する(walkMediaRoot の戻り値への map)
    const found: Array<{ fileName: string; storedRoot: string }> = [];
    for (let i = 0; i < resolvedRoots.length; i++) {
      const storedRoot = scannedRoots[i]!;
      const filesInRoot = await walkMediaRoot(resolvedRoots[i]!);
      found.push(...filesInRoot.map((f) => ({ fileName: f.fileName, storedRoot })));
    }

    expect(found.find((f) => f.fileName === 'a.mp4')?.storedRoot).toBe(storedA);
    expect(found.find((f) => f.fileName === 'b.mov')?.storedRoot).toBe(storedB);
  });
});
