import { describe, expect, it } from 'vitest';
import {
  canonicalMediaPath,
  isWindowsDrivePath,
  resolveMediaRoot,
  windowsToWslPath,
} from './winpath.js';

describe('isWindowsDrivePath / windowsToWslPath', () => {
  it('ドライブパスを判定する', () => {
    expect(isWindowsDrivePath('C:\\Users\\foo')).toBe(true);
    expect(isWindowsDrivePath('e:/footage')).toBe(true);
    expect(isWindowsDrivePath('/mnt/c/Users')).toBe(false);
    expect(isWindowsDrivePath('./relative')).toBe(false);
  });

  it('WSL マウントパスへ変換する(日本語・スペース込み)', () => {
    expect(windowsToWslPath('C:\\Users\\kanch\\Downloads\\11_写真・画像\\2026-04-19 Day2')).toBe(
      '/mnt/c/Users/kanch/Downloads/11_写真・画像/2026-04-19 Day2',
    );
    expect(windowsToWslPath('E:/footage')).toBe('/mnt/e/footage');
    expect(windowsToWslPath('/already/posix')).toBe('/already/posix');
  });
});

describe('canonicalMediaPath', () => {
  it('Windows 形式と WSL 形式が同一の正規形になる', () => {
    const win = canonicalMediaPath('C:\\foo\\Bar.MP4');
    const wsl = canonicalMediaPath('/mnt/c/foo/Bar.MP4');
    expect(win).toBe('c:/foo/Bar.MP4');
    expect(wsl).toBe(win);
  });

  it('非 Windows パスはそのまま', () => {
    expect(canonicalMediaPath('/srv/media/a.mp4')).toBe('/srv/media/a.mp4');
  });
});

describe('resolveMediaRoot', () => {
  it('Linux 上では Windows パスを /mnt に変換して解決する', () => {
    const exists = (p: string): boolean => p === '/mnt/c/footage';
    expect(resolveMediaRoot('C:\\footage', { platform: 'linux', exists })).toBe('/mnt/c/footage');
    expect(resolveMediaRoot('D:\\nope', { platform: 'linux', exists })).toBeNull();
  });

  it('存在する POSIX パスはそのまま', () => {
    const exists = (p: string): boolean => p === '/data/videos';
    expect(resolveMediaRoot('/data/videos', { platform: 'linux', exists })).toBe('/data/videos');
    expect(resolveMediaRoot('/data/missing', { platform: 'linux', exists })).toBeNull();
  });

  it('win32 では変換せずに解決する', () => {
    const exists = (p: string): boolean => /footage/.test(p);
    expect(resolveMediaRoot('C:\\footage', { platform: 'win32', exists })).toBe('C:\\footage');
  });
});
