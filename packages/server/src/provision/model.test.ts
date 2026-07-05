import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { whisperSizeFromPath, whisperModelUrl, ensureWhisperModel } from './model.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-model-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('whisperSizeFromPath', () => {
  it('ggml-<size>.bin からサイズを取り出す', () => {
    expect(whisperSizeFromPath('/x/models/ggml-small.bin')).toBe('small');
    expect(whisperSizeFromPath('ggml-large-v3-turbo.bin')).toBe('large-v3-turbo');
  });
  it('パターン不一致は null', () => {
    expect(whisperSizeFromPath('/x/foo.txt')).toBeNull();
    expect(whisperSizeFromPath('model.bin')).toBeNull();
  });
});

describe('whisperModelUrl', () => {
  it('HF の resolve URL を組み立てる', () => {
    expect(whisperModelUrl('small')).toBe(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    );
  });
});

describe('ensureWhisperModel', () => {
  function bytesRes(bytes: Uint8Array): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-length': String(bytes.length) }),
      body: null,
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    } as unknown as Response;
  }

  it('未存在ならファイル名からサイズ推定して DL・配置する', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'models', 'ggml-small.bin');
    const payload = new Uint8Array(2000).fill(7); // 1000 バイト超
    const result = await ensureWhisperModel({
      destPath: dest,
      fetchImpl: (async () => bytesRes(payload)) as unknown as typeof fetch,
    });
    expect(result).toBe('installed');
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).size).toBe(2000);
  });

  it('既存(サイズ>0)なら skip', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'ggml-small.bin');
    fs.writeFileSync(dest, Buffer.alloc(5000));
    let fetched = false;
    const result = await ensureWhisperModel({
      destPath: dest,
      fetchImpl: (async () => {
        fetched = true;
        return bytesRes(new Uint8Array(2000));
      }) as unknown as typeof fetch,
    });
    expect(result).toBe('exists');
    expect(fetched).toBe(false);
  });

  it('取得サイズが小さすぎると例外', async () => {
    const dir = tmp();
    const dest = path.join(dir, 'ggml-small.bin');
    await expect(
      ensureWhisperModel({
        destPath: dest,
        fetchImpl: (async () => bytesRes(new Uint8Array(10))) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/小さすぎます/);
  });
});
