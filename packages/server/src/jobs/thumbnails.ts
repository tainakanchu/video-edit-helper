import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { locateInFiles, type Clip, type FileSpan, type ThumbManifest } from '@veh/shared';
import type { Config } from '../config.js';

/** ジョブ内のフレーム抽出並列数 */
const FRAME_CONCURRENCY = 2;

/** clip × interval のサムネイル出力ディレクトリ */
export function thumbDir(config: Config, clipId: string, intervalSec: number): string {
  return path.join(config.thumbsDir, clipId, String(intervalSec));
}

/** 個別フレームの出力パス(整数秒) */
export function thumbFilePath(
  config: Config,
  clipId: string,
  intervalSec: number,
  timeSec: number,
): string {
  return path.join(thumbDir(config, clipId, intervalSec), `${Math.round(timeSec)}.jpg`);
}

/** interval ごとの抽出時刻列(0, interval, 2*interval, ... < durationSec) */
export function thumbTimes(durationSec: number, intervalSec: number): number[] {
  const times: number[] = [];
  for (let t = 0; t < durationSec; t += intervalSec) {
    times.push(Math.round(t));
  }
  return times;
}

/** 1 フレームを ffmpeg で抽出(-ss を -i より前=高速シーク) */
function extractFrame(
  ffmpegPath: string,
  srcPath: string,
  offsetSec: number,
  outPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-ss',
      String(offsetSec),
      '-i',
      srcPath,
      '-frames:v',
      '1',
      '-vf',
      'scale=320:-2',
      '-q:v',
      '6',
      '-y',
      outPath,
    ];
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg thumb failed (${code}): ${stderr.trim()}`));
    });
  });
}

/**
 * クリップの指定 interval のサムネイルを生成。既存ファイルはスキップ(再開可能)。
 */
export async function generateThumbs(
  config: Config,
  clip: Clip,
  intervalSec: number,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  const dir = thumbDir(config, clip.id, intervalSec);
  await fsp.mkdir(dir, { recursive: true });
  const times = thumbTimes(clip.durationSec, intervalSec);
  const spans: FileSpan[] = clip.files.map((f) => ({
    id: f.id,
    startOffsetSec: f.startOffsetSec,
    durationSec: f.durationSec,
  }));

  let done = 0;
  const total = times.length || 1;

  // 並列度 FRAME_CONCURRENCY のワーカープール
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = cursor++;
      if (idx >= times.length) return;
      const t = times[idx]!;
      const out = thumbFilePath(config, clip.id, intervalSec, t);
      if (!fs.existsSync(out)) {
        const loc = locateInFiles(spans, t);
        const file = clip.files[loc.index]!;
        try {
          await extractFrame(config.ffmpegPath, file.path, loc.offsetSec, out);
        } catch (e) {
          // 1 フレームの失敗はスキップして続行(末尾付近のシーク失敗等)
          console.warn(`[thumbs] frame skipped ${clip.id}@${t}s: ${(e as Error).message}`);
        }
      }
      done++;
      onProgress?.(done / total);
    }
  };

  await Promise.all(Array.from({ length: FRAME_CONCURRENCY }, () => worker()));
  onProgress?.(1);
}

/** GET 時にディレクトリ走査で ThumbManifest を構築 */
export async function buildThumbManifest(config: Config, clipId: string): Promise<ThumbManifest> {
  const intervals: Record<string, number[]> = {};
  const base = path.join(config.thumbsDir, clipId);
  let intervalDirs: string[];
  try {
    intervalDirs = await fsp.readdir(base);
  } catch {
    return { clipId, intervals };
  }
  for (const intervalKey of intervalDirs) {
    const dir = path.join(base, intervalKey);
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    const times = files
      .filter((f) => f.endsWith('.jpg'))
      .map((f) => Number(f.slice(0, -4)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    intervals[intervalKey] = times;
  }
  return { clipId, intervals };
}

/** 指定 interval のサムネイルが全て生成済みか(スキップ判定用) */
export function thumbsComplete(config: Config, clip: Clip, intervalSec: number): boolean {
  const times = thumbTimes(clip.durationSec, intervalSec);
  if (times.length === 0) return true;
  return times.every((t) => fs.existsSync(thumbFilePath(config, clip.id, intervalSec, t)));
}
