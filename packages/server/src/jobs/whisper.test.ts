import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Transcript } from '@veh/shared';
import type { Config } from '../config.js';
import { hasTranscript, readTranscript, transcriptPath } from './whisper.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-whisper-'));
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
    whisperModelPath: '/models/ggml-small.bin',
    whisperThreads: 2,
    whisperLanguage: 'auto',
    webDistDir: '',
  };
}

describe('transcript 永続化ヘルパー', () => {
  it('transcriptPath は transcriptsDir/<clipId>.json', () => {
    const config = mkConfig();
    expect(transcriptPath(config, 'c1')).toBe(path.join(config.transcriptsDir, 'c1.json'));
  });

  it('未生成は hasTranscript=false / readTranscript=null', async () => {
    const config = mkConfig();
    expect(hasTranscript(config, 'c1')).toBe(false);
    expect(await readTranscript(config, 'c1')).toBeNull();
  });

  it('保存済みは読み戻せる', async () => {
    const config = mkConfig();
    fs.mkdirSync(config.transcriptsDir, { recursive: true });
    const t: Transcript = {
      clipId: 'c1',
      model: 'ggml-small',
      segments: [{ start: 1, end: 2, text: 'こんにちは' }],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    fs.writeFileSync(transcriptPath(config, 'c1'), JSON.stringify(t));
    expect(hasTranscript(config, 'c1')).toBe(true);
    const read = await readTranscript(config, 'c1');
    expect(read).toEqual(t);
  });
});
