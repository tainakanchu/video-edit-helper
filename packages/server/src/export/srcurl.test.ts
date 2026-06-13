import { describe, it, expect } from 'vitest';
import { pathToFileUrl } from './srcurl.js';

describe('pathToFileUrl', () => {
  it('WSL パス: スペースと日本語を含む', () => {
    const result = pathToFileUrl('/mnt/c/Users/foo bar/動画.MP4');
    expect(result).toBe('file:///C:/Users/foo%20bar/%E5%8B%95%E7%94%BB.MP4');
  });
  it('WSL パス: ドライブ文字が大文字になる', () => {
    expect(pathToFileUrl('/mnt/c/test.mp4')).toMatch(/^file:\/\/\/C:\//);
  });
  it('Windows バックスラッシュ形式', () => {
    const result = pathToFileUrl('C:\\Users\\foo\\VCAM 0033.MP4');
    expect(result).toBe('file:///C:/Users/foo/VCAM%200033.MP4');
  });
  it('Windows スラッシュ形式', () => {
    const result = pathToFileUrl('C:/Users/foo/bar.mp4');
    expect(result).toBe('file:///C:/Users/foo/bar.mp4');
  });
  it('POSIX パス: シンプル', () => {
    const result = pathToFileUrl('/home/user/v.mp4');
    expect(result).toBe('file:///home/user/v.mp4');
  });
  it('ドライブコロンがエンコードされない (%3A なし)', () => {
    const result = pathToFileUrl('C:/test.mp4');
    expect(result).not.toContain('%3A');
    expect(result).toContain('C:/');
  });
  it('小文字ドライブが大文字になる', () => {
    const result = pathToFileUrl('d:/test.mp4');
    expect(result).toContain('D:/');
  });
});
