import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRanges, type Clip, type TimeRange, type VadResult } from '@veh/shared';
import type { VadProvider } from '../vad/silencedetect.js';
import { SilenceDetectProvider } from '../vad/silencedetect.js';
import { SileroProvider } from '../vad/silero.js';
import type { Config } from '../config.js';

/** ファイルローカル秒のマージにも使う epsilon */
const VAD_EPSILON = 0.5;

/** silero が使えれば silero、ダメなら silencedetect。選択結果をログ出力 */
export async function selectVadProvider(config: Config): Promise<VadProvider> {
  // パッケージ版(単一バイナリ)は onnxruntime-node を同梱しないため明示的に無効化できる
  if (config.disableSilero) {
    console.log('[vad] provider: silencedetect (silero 無効化)');
    return new SilenceDetectProvider(config.ffmpegPath);
  }
  try {
    const provider = await SileroProvider.create(config.vadModelPath, config.ffmpegPath);
    console.log('[vad] provider: silero');
    return provider;
  } catch (e) {
    console.log(`[vad] silero 利用不可 (${(e as Error).message}) → silencedetect にフォールバック`);
    return new SilenceDetectProvider(config.ffmpegPath);
  }
}

/** VAD 結果 JSON のパス */
export function vadResultPath(config: Config, clipId: string): string {
  return path.join(config.vadDir, `${clipId}.json`);
}

/** 既に VAD 結果が存在するか */
export function hasVadResult(config: Config, clipId: string): boolean {
  return fs.existsSync(vadResultPath(config, clipId));
}

/**
 * クリップ全ファイルに VAD を実行し、startOffsetSec を足して通しタイムコード化、
 * normalizeRanges(epsilon 0.5)して VadResult を保存する。
 */
export async function runVadForClip(
  config: Config,
  provider: VadProvider,
  clip: Clip,
  onProgress?: (ratio: number) => void,
): Promise<VadResult> {
  const all: TimeRange[] = [];
  const total = clip.files.length;
  for (let i = 0; i < clip.files.length; i++) {
    const file = clip.files[i]!;
    const local = await provider.detectFile(file.path, file.durationSec, (r) => {
      onProgress?.((i + r) / total);
    });
    for (const seg of local) {
      all.push({
        start: seg.start + file.startOffsetSec,
        end: seg.end + file.startOffsetSec,
      });
    }
  }
  const result: VadResult = {
    clipId: clip.id,
    provider: provider.name,
    segments: normalizeRanges(all, VAD_EPSILON),
    generatedAt: new Date().toISOString(),
  };
  await fsp.writeFile(vadResultPath(config, clip.id), JSON.stringify(result), 'utf8');
  onProgress?.(1);
  return result;
}

/** 保存済み VAD 結果を読む(無ければ null) */
export async function readVadResult(config: Config, clipId: string): Promise<VadResult | null> {
  try {
    const raw = await fsp.readFile(vadResultPath(config, clipId), 'utf8');
    return JSON.parse(raw) as VadResult;
  } catch {
    return null;
  }
}
