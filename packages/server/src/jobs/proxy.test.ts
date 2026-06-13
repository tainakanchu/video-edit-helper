import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clip, SourceFile } from '@veh/shared';
import type { Config } from '../config.js';
import { clipNeedsProxy, hasProxy, proxyComplete, proxyFilePath } from './proxy.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-proxy-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function mkConfig(): Config {
  return {
    projectDir: dir,
    projectFile: path.join(dir, 'project.json'),
    backupsDir: path.join(dir, 'backups'),
    thumbsDir: path.join(dir, 'thumbs'),
    vadDir: path.join(dir, 'vad'),
    proxiesDir: path.join(dir, 'proxies'),
    transcriptsDir: path.join(dir, 'transcripts'),
    scenesDir: path.join(dir, 'scenes'),
    port: 0,
    ffmpegPath: 'ffmpeg',
    ffprobePath: 'ffprobe',
    vadModelPath: '',
    whisperPath: 'whisper-cli',
    whisperModelPath: '',
    whisperThreads: 2,
    whisperLanguage: 'auto',
    webDistDir: '',
  };
}

function mkFile(id: string, playable: boolean, proxyAvailable?: boolean): SourceFile {
  return {
    id,
    path: `/media/${id}.MP4`,
    fileName: `${id}.MP4`,
    sizeBytes: 100,
    durationSec: 60,
    width: 1920,
    height: 1080,
    videoCodec: 'hevc',
    audioCodec: 'aac',
    fps: 30,
    createdAt: null,
    mtime: '2025-01-01T00:00:00.000Z',
    startOffsetSec: 0,
    playableInBrowser: playable,
    ...(proxyAvailable !== undefined ? { proxyAvailable } : {}),
  };
}

function mkClip(files: SourceFile[]): Clip {
  return {
    id: 'c1',
    dayId: '2025-01-01',
    name: 'c1.MP4',
    cameraLabel: 'cam',
    files,
    durationSec: files.reduce((s, f) => s + f.durationSec, 0),
    recordedAt: '2025-01-01T10:00:00.000Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
  };
}

describe('proxyFilePath', () => {
  it('proxiesDir/<fileId>.mp4 を返す', () => {
    const config = mkConfig();
    expect(proxyFilePath(config, 'abc')).toBe(path.join(config.proxiesDir, 'abc.mp4'));
  });
});

describe('hasProxy', () => {
  it('未生成は false', () => {
    expect(hasProxy(mkConfig(), 'abc')).toBe(false);
  });

  it('サイズ > 0 のファイルがあれば true', () => {
    const config = mkConfig();
    fs.mkdirSync(config.proxiesDir, { recursive: true });
    fs.writeFileSync(proxyFilePath(config, 'abc'), 'x');
    expect(hasProxy(config, 'abc')).toBe(true);
  });

  it('空ファイルは false', () => {
    const config = mkConfig();
    fs.mkdirSync(config.proxiesDir, { recursive: true });
    fs.writeFileSync(proxyFilePath(config, 'abc'), '');
    expect(hasProxy(config, 'abc')).toBe(false);
  });
});

describe('clipNeedsProxy / proxyComplete', () => {
  it('全ファイル再生可ならプロキシ不要', () => {
    const config = mkConfig();
    const clip = mkClip([mkFile('f1', true)]);
    expect(clipNeedsProxy(config, clip)).toBe(false);
    expect(proxyComplete(config, clip)).toBe(true);
  });

  it('非再生かつ未生成ファイルがあればプロキシ必要', () => {
    const config = mkConfig();
    const clip = mkClip([mkFile('f1', true), mkFile('f2', false)]);
    expect(clipNeedsProxy(config, clip)).toBe(true);
    expect(proxyComplete(config, clip)).toBe(false);
  });

  it('非再生でもプロキシ生成済みなら不要', () => {
    const config = mkConfig();
    fs.mkdirSync(config.proxiesDir, { recursive: true });
    fs.writeFileSync(proxyFilePath(config, 'f2'), 'x');
    const clip = mkClip([mkFile('f2', false)]);
    expect(clipNeedsProxy(config, clip)).toBe(false);
    expect(proxyComplete(config, clip)).toBe(true);
  });

  it('proxyAllFiles=true なら再生可能ファイルも対象になる', () => {
    const config = mkConfig();
    const clip = mkClip([mkFile('f1', true)]);
    // 通常はプロキシ不要だが、proxyAllFiles=true なら必要
    expect(clipNeedsProxy(config, clip, false)).toBe(false);
    expect(clipNeedsProxy(config, clip, true)).toBe(true);
    expect(proxyComplete(config, clip, true)).toBe(false);
  });

  it('proxyAllFiles=true でも生成済みファイルは不要', () => {
    const config = mkConfig();
    fs.mkdirSync(config.proxiesDir, { recursive: true });
    fs.writeFileSync(proxyFilePath(config, 'f1'), 'x');
    const clip = mkClip([mkFile('f1', true)]);
    expect(clipNeedsProxy(config, clip, true)).toBe(false);
    expect(proxyComplete(config, clip, true)).toBe(true);
  });
});
