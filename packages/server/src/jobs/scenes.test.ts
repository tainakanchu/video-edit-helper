import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SceneList } from '@veh/shared';
import type { Config } from '../config.js';
import {
  hasScenes,
  mergeSceneTimes,
  parseScenePtsTimes,
  readScenes,
  scenesPath,
} from './scenes.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-scenes-'));
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

// metadata=print の典型的な stderr 出力(scene_score 行と pts_time 行が交互に並ぶ)
const SAMPLE_STDERR = [
  'ffmpeg version n6.0 Copyright (c) ...',
  '  Stream #0:0: Video: h264 ...',
  '[Parsed_metadata_2 @ 0x55a] frame:12  pts:512512  pts_time:5.339',
  '[Parsed_metadata_2 @ 0x55a]   lavfi.scene_score=0.412345',
  '[Parsed_metadata_2 @ 0x55a] frame:48  pts:2050048  pts_time:21.355',
  '[Parsed_metadata_2 @ 0x55a]   lavfi.scene_score=0.501234',
  '[Parsed_metadata_2 @ 0x55a] frame:120  pts:5125120  pts_time:53.387',
  '[Parsed_metadata_2 @ 0x55a]   lavfi.scene_score=0.387654',
  'frame=  300 fps=120 q=-0.0 Lsize=N/A time=00:01:00.00 ...',
].join('\n');

describe('parseScenePtsTimes', () => {
  it('pts_time の秒を全て抽出する', () => {
    expect(parseScenePtsTimes(SAMPLE_STDERR)).toEqual([5.339, 21.355, 53.387]);
  });

  it('pts_time を含まない出力では空配列', () => {
    const stderr = 'ffmpeg version n6.0\n  Stream #0:0: Video: h264 ...\nframe= 10 fps=0';
    expect(parseScenePtsTimes(stderr)).toEqual([]);
  });

  it('空文字列は空配列', () => {
    expect(parseScenePtsTimes('')).toEqual([]);
  });
});

describe('mergeSceneTimes', () => {
  it('昇順ソートする', () => {
    expect(mergeSceneTimes([21.355, 5.339, 53.387])).toEqual([5.339, 21.355, 53.387]);
  });

  it('1.5 秒未満の近接点を間引く(先勝ち)', () => {
    // 10.0 と 10.8(差 0.8 < 1.5)→ 10.8 を捨てる。12.0 は採用
    expect(mergeSceneTimes([10.0, 10.8, 12.0])).toEqual([10.0, 12.0]);
  });

  it('ちょうど 1.5 秒差は両方残す', () => {
    expect(mergeSceneTimes([10.0, 11.5])).toEqual([10.0, 11.5]);
  });

  it('複数ファイルの通しタイムコードをマージできる', () => {
    // ファイル1: 5, 50 / ファイル2(offset 60): 62, 62.5(近接), 80
    expect(mergeSceneTimes([5, 50, 62, 62.5, 80])).toEqual([5, 50, 62, 80]);
  });

  it('負値・非数を除外する', () => {
    expect(mergeSceneTimes([-1, NaN, 3, 5])).toEqual([3, 5]);
  });

  it('閾値は引数で上書きできる', () => {
    expect(mergeSceneTimes([10, 11, 12], 3)).toEqual([10]);
  });
});

describe('scenes 永続化ヘルパー', () => {
  it('scenesPath は scenesDir/<clipId>.json', () => {
    const config = mkConfig();
    expect(scenesPath(config, 'c1')).toBe(path.join(config.scenesDir, 'c1.json'));
  });

  it('未生成は hasScenes=false / readScenes=null', async () => {
    const config = mkConfig();
    expect(hasScenes(config, 'c1')).toBe(false);
    expect(await readScenes(config, 'c1')).toBeNull();
  });

  it('保存済みは読み戻せる', async () => {
    const config = mkConfig();
    fs.mkdirSync(config.scenesDir, { recursive: true });
    const list: SceneList = {
      clipId: 'c1',
      times: [5.3, 21.4],
      generatedAt: '2026-01-01T00:00:00.000Z',
    };
    fs.writeFileSync(scenesPath(config, 'c1'), JSON.stringify(list));
    expect(hasScenes(config, 'c1')).toBe(true);
    expect(await readScenes(config, 'c1')).toEqual(list);
  });
});
