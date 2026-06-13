import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Clip, SourceFile } from '@veh/shared';
import type { Config } from '../config.js';

/** fileId に対応するプロキシ動画(常に mp4)のパス */
export function proxyFilePath(config: Config, fileId: string): string {
  return path.join(config.proxiesDir, `${fileId}.mp4`);
}

/** プロキシが生成済みか(ファイルが存在しサイズ > 0) */
export function hasProxy(config: Config, fileId: string): boolean {
  try {
    const st = fs.statSync(proxyFilePath(config, fileId));
    return st.size > 0;
  } catch {
    return false;
  }
}

/**
 * このファイルがプロキシ生成の「対象」か。
 * 通常はブラウザ非再生ファイルのみ。proxyAllFiles=true なら全ファイルが対象。
 */
function isProxyTarget(file: SourceFile, proxyAllFiles: boolean): boolean {
  return proxyAllFiles || file.playableInBrowser === false;
}

/** プロキシ生成が必要なファイル: 対象かつ未生成 */
function needsProxy(config: Config, file: SourceFile, proxyAllFiles: boolean): boolean {
  return isProxyTarget(file, proxyAllFiles) && !hasProxy(config, file.id);
}

/** クリップにプロキシ生成対象ファイルが 1 つでも含まれるか(自動投入の判定用) */
export function clipNeedsProxy(config: Config, clip: Clip, proxyAllFiles = false): boolean {
  return clip.files.some((f) => needsProxy(config, f, proxyAllFiles));
}

/** クリップの全ファイルが対象外 or 生成済み(=スキップ可能)か */
export function proxyComplete(config: Config, clip: Clip, proxyAllFiles = false): boolean {
  return !clipNeedsProxy(config, clip, proxyAllFiles);
}

/**
 * 1 ファイルを ffmpeg で 720p H.264 プロキシに変換する。
 * tmp に書いてから rename することで、途中失敗した中途半端なファイルを残さない。
 */
function transcodeProxy(ffmpegPath: string, srcPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${outPath}.tmp-${process.pid}`;
    const args = [
      '-y',
      '-i',
      srcPath,
      '-vf',
      'scale=-2:720',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      '+faststart',
      // tmp ファイル名は .mp4 で終わらないため出力フォーマットを明示する
      '-f',
      'mp4',
      tmp,
    ];
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        fsp
          .rename(tmp, outPath)
          .then(() => resolve())
          .catch(reject);
      } else {
        // 失敗時は tmp を片付けてからエラー
        fsp.rm(tmp, { force: true }).finally(() => {
          reject(new Error(`ffmpeg proxy failed (${code}): ${stderr.trim()}`));
        });
      }
    });
  });
}

/**
 * クリップ内の対象ファイル(対象かつ未生成)をプロキシ化する。
 * proxyAllFiles=true なら再生可能ファイルも対象に含める。
 * 1 ファイル成功するごとに onFileDone を呼んで store のフラグ更新を委譲する。
 */
export async function generateProxies(
  config: Config,
  clip: Clip,
  onFileDone: (fileId: string) => void,
  onProgress?: (ratio: number) => void,
  onMessage?: (message: string) => void,
  proxyAllFiles = false,
): Promise<void> {
  await fsp.mkdir(config.proxiesDir, { recursive: true });
  const targets = clip.files.filter((f) => needsProxy(config, f, proxyAllFiles));
  const total = targets.length || 1;
  let done = 0;
  for (const file of targets) {
    onMessage?.(`proxy: ${file.fileName}`);
    const out = proxyFilePath(config, file.id);
    await transcodeProxy(config.ffmpegPath, file.path, out);
    onFileDone(file.id);
    done++;
    onProgress?.(done / total);
  }
  onProgress?.(1);
}
