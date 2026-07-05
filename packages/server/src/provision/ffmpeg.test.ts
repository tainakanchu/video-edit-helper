import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, strToU8 } from 'fflate';
import {
  ffmpegStaticAssetName,
  ffmpegStaticUrl,
  ensureFfBinary,
  FFSTATIC_TAG,
} from './ffmpeg.js';
import type { SetupEvent } from './progress.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-ff-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const fetchReturning = (res: unknown): typeof fetch =>
  (async () => res as Response) as unknown as typeof fetch;

function gzRes(bytes: Uint8Array): Response {
  const gz = gzipSync(bytes);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-length': String(gz.length) }),
    body: null,
    arrayBuffer: async () => new Uint8Array(gz).buffer,
  } as unknown as Response;
}

describe('ffmpegStaticAssetName', () => {
  it('Apple Silicon は arm64 ネイティブを選ぶ(Rosetta 不使用)', () => {
    expect(ffmpegStaticAssetName('ffmpeg', 'darwin', 'arm64')).toBe('ffmpeg-darwin-arm64.gz');
    expect(ffmpegStaticAssetName('ffprobe', 'darwin', 'arm64')).toBe('ffprobe-darwin-arm64.gz');
  });
  it('他プラットフォームも platform-arch をそのまま使う', () => {
    expect(ffmpegStaticAssetName('ffmpeg', 'darwin', 'x64')).toBe('ffmpeg-darwin-x64.gz');
    expect(ffmpegStaticAssetName('ffmpeg', 'win32', 'x64')).toBe('ffmpeg-win32-x64.gz');
    expect(ffmpegStaticAssetName('ffprobe', 'linux', 'x64')).toBe('ffprobe-linux-x64.gz');
    expect(ffmpegStaticAssetName('ffprobe', 'linux', 'arm64')).toBe('ffprobe-linux-arm64.gz');
  });
});

describe('ffmpegStaticUrl', () => {
  it('リリースタグとアセット名を含む URL を作る', () => {
    const url = ffmpegStaticUrl('ffmpeg', 'darwin', 'arm64');
    expect(url).toContain(`/${FFSTATIC_TAG}/`);
    expect(url).toContain('ffmpeg-darwin-arm64.gz');
    expect(url.startsWith('https://github.com/eugeneware/ffmpeg-static/releases/download/')).toBe(true);
  });
});

describe('ensureFfBinary', () => {
  it('未存在なら .gz を DL・gunzip して実行権限付きで配置する', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'ffmpeg');
    const events: SetupEvent[] = [];
    const result = await ensureFfBinary({
      name: 'ffmpeg',
      destPath: dest,
      url: 'http://x/ffmpeg-darwin-arm64.gz',
      fetchImpl: fetchReturning(gzRes(strToU8('FAKE_FFMPEG_BINARY'))),
      emit: (e) => events.push(e),
    });
    expect(result).toBe('installed');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('FAKE_FFMPEG_BINARY');
    expect(fs.statSync(dest).mode & 0o111).not.toBe(0);
    expect(events.some((e) => e.phase === 'ffmpeg' && e.status === 'extracting')).toBe(true);
    expect(events.some((e) => e.phase === 'ffmpeg' && e.status === 'done')).toBe(true);
  });

  it('既に存在すれば skip して再取得しない', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'ffprobe');
    fs.writeFileSync(dest, 'EXISTING');
    let fetched = false;
    const result = await ensureFfBinary({
      name: 'ffprobe',
      destPath: dest,
      url: 'http://x/ffprobe-darwin-arm64.gz',
      fetchImpl: (async () => {
        fetched = true;
        return gzRes(strToU8('NEW'));
      }) as unknown as typeof fetch,
    });
    expect(result).toBe('exists');
    expect(fetched).toBe(false);
    expect(fs.readFileSync(dest, 'utf8')).toBe('EXISTING');
  });
});
