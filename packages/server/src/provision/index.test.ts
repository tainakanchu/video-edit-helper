import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { ensureDependencies } from './index.js';
import type { SetupEvent } from './progress.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-prov-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function baseConfig(over: Partial<Config>): Config {
  // ensureDependencies が参照するフィールドだけ与える(他はテストに無関係)
  return {
    autoProvision: true,
    ffmpegPath: 'ffmpeg', // 非絶対 → PATH 運用扱いでスキップ
    ffprobePath: 'ffprobe',
    whisperModelPath: path.join(dir, 'models', 'ggml-small.bin'),
    ...over,
  } as unknown as Config;
}

describe('ensureDependencies: whisper は任意機能なので起動をブロックしない', () => {
  it('whisper モデル取得が失敗しても reject せず ready を出す', async () => {
    const events: SetupEvent[] = [];
    // basename が ggml-*.bin でない → URL 決定不能で ensureWhisperModel は throw する
    const config = baseConfig({ whisperModelPath: path.join(dir, 'not-a-model.bin') });

    await expect(ensureDependencies(config, (ev) => events.push(ev))).resolves.toBeUndefined();

    // whisper は skip 扱いで握られ、全体は準備完了に到達する
    expect(events.some((e) => e.phase === 'model' && e.status === 'skip')).toBe(true);
    expect(events.some((e) => e.phase === 'ready' && e.status === 'done')).toBe(true);
  });

  it('whisper モデルが既に存在すれば skip して ready に到達する', async () => {
    const events: SetupEvent[] = [];
    const modelPath = path.join(dir, 'models', 'ggml-small.bin');
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, 'x'.repeat(2048)); // 実体あり扱い
    const config = baseConfig({ whisperModelPath: modelPath });

    await expect(ensureDependencies(config, (ev) => events.push(ev))).resolves.toBeUndefined();
    expect(events.some((e) => e.phase === 'model' && e.status === 'skip')).toBe(true);
    expect(events.some((e) => e.phase === 'ready' && e.status === 'done')).toBe(true);
  });
});
