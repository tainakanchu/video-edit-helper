import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Clip, SceneList } from '@veh/shared';
import type { Config } from '../config.js';

/** 近接転換点の間引き閾値(秒)。これ未満の間隔は同一シーンとして 1 点に潰す */
const SCENE_MIN_GAP_SEC = 1.5;
/** scene 検出の閾値(0..1)。大きいほど転換点が減る */
const SCENE_THRESHOLD = 0.35;

/** シーン結果 JSON のパス */
export function scenesPath(config: Config, clipId: string): string {
  return path.join(config.scenesDir, `${clipId}.json`);
}

/** 既にシーン結果が存在するか(スキップ判定用) */
export function hasScenes(config: Config, clipId: string): boolean {
  return fs.existsSync(scenesPath(config, clipId));
}

/** 保存済みシーン結果を読む(無ければ null) */
export async function readScenes(config: Config, clipId: string): Promise<SceneList | null> {
  try {
    const raw = await fsp.readFile(scenesPath(config, clipId), 'utf8');
    return JSON.parse(raw) as SceneList;
  } catch {
    return null;
  }
}

/**
 * ffmpeg の metadata=print 出力(stderr)から場面転換点(pts_time の秒)を抽出する純関数。
 * 行例: `[Parsed_metadata_1 @ 0x...] frame:12  pts:512512  pts_time:5.339`
 * select フィルタを通過したフレーム(=転換点)のみが print されるので、
 * lavfi.scene_score 行とペアになる pts_time をそのまま転換点として扱う。
 */
export function parseScenePtsTimes(stderr: string): number[] {
  const times: number[] = [];
  const re = /pts_time:\s*([\d.]+)/;
  for (const line of stderr.split('\n')) {
    const m = line.match(re);
    if (!m) continue;
    const t = Number(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

/**
 * 通しタイムコード化済みの転換点配列(複数ファイル分)を昇順にマージし、
 * 近接(SCENE_MIN_GAP_SEC 未満)の点を間引く純関数。
 * 直前に採用した点との差が閾値未満なら捨てる(先勝ち)。
 */
export function mergeSceneTimes(times: number[], minGapSec = SCENE_MIN_GAP_SEC): number[] {
  const sorted = times.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || t - last >= minGapSec) {
      out.push(t);
    }
  }
  return out;
}

/**
 * 1 ファイルに対して scene 検出 ffmpeg を実行し、ファイルローカル秒の転換点配列を返す。
 * `select='gt(scene,TH)',metadata=print` を全デコードで走らせ、stderr をパースする。
 */
function detectScenesInFile(ffmpegPath: string, srcPath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i',
      srcPath,
      '-vf',
      `select='gt(scene,${SCENE_THRESHOLD})',metadata=print`,
      '-an',
      '-f',
      'null',
      '-',
    ];
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(parseScenePtsTimes(stderr));
      } else {
        reject(new Error(`ffmpeg scenes failed (${code}): ${stderr.trim().slice(-500)}`));
      }
    });
  });
}

/**
 * クリップ全ファイルでシーン検出を実行し、startOffsetSec を足して通しタイムコード化、
 * 昇順マージ + 近接間引きして cache/scenes/<clipId>.json に保存する。
 * progress はファイル単位。
 */
export async function detectScenesForClip(
  config: Config,
  clip: Clip,
  onProgress?: (ratio: number) => void,
  onMessage?: (message: string) => void,
): Promise<SceneList> {
  await fsp.mkdir(config.scenesDir, { recursive: true });
  const all: number[] = [];
  const total = clip.files.length || 1;
  for (let i = 0; i < clip.files.length; i++) {
    const file = clip.files[i]!;
    onMessage?.(`scenes: ${file.fileName}`);
    const local = await detectScenesInFile(config.ffmpegPath, file.path);
    for (const t of local) {
      all.push(t + file.startOffsetSec);
    }
    onProgress?.((i + 1) / total);
  }
  const result: SceneList = {
    clipId: clip.id,
    times: mergeSceneTimes(all),
    generatedAt: new Date().toISOString(),
  };
  await fsp.writeFile(scenesPath(config, clip.id), JSON.stringify(result), 'utf8');
  onProgress?.(1);
  return result;
}
