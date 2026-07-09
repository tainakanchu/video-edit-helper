import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ProjectSettings } from '@veh/shared';
import { ffprobe } from './ffprobe.js';
import { buildDaysAndClips, type GroupingResult, type ProbedFile } from './grouping.js';
import { resolveMediaRoot } from './winpath.js';
import { resolveMediaPath, toStoredPath, type MountMap } from '../media/mounts.js';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v']);
const PROBE_CONCURRENCY = 4;

/** 走査で見つかった候補ファイル(ffprobe 前) */
interface FoundFile {
  path: string;
  fileName: string;
  dir: string;
  mediaRoot: string;
}

/**
 * 走査対象外のディレクトリ判定。
 * 隠しディレクトリ(.始まり)に加え、OS のゴミ箱/システムフォルダ(削除済み素材が混じる)を除外する。
 */
export function isIgnoredDir(name: string): boolean {
  if (name.startsWith('.')) return true; // Unix 隠し(.Trashes / .Spotlight-V100 等も含む)
  const lower = name.toLowerCase();
  return (
    lower === '$recycle.bin' || // Windows ごみ箱
    lower === 'recycler' || // 旧 Windows ごみ箱
    lower === 'system volume information' || // Windows システムフォルダ
    lower === '#recycle' || // Synology NAS ごみ箱
    lower === '@recycle' || // QNAP NAS ごみ箱
    lower === 'found.000' // chkdsk 復旧フォルダ
  );
}

/** mediaRoot を再帰走査して対象拡張子ファイルを列挙(隠し/ゴミ箱ディレクトリ skip) */
export async function walkMediaRoot(mediaRoot: string): Promise<FoundFile[]> {
  const out: FoundFile[] = [];
  async function recur(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 読めないディレクトリはスキップ
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (isIgnoredDir(ent.name)) continue; // 隠し/ゴミ箱/システムフォルダは辿らない
        await recur(full);
      } else if (ent.isFile()) {
        if (ent.name.startsWith('.')) continue; // 隠しファイル skip
        const ext = path.extname(ent.name).toLowerCase();
        if (VIDEO_EXTS.has(ext)) {
          out.push({ path: full, fileName: ent.name, dir, mediaRoot });
        }
      }
    }
  }
  await recur(mediaRoot);
  return out;
}

export interface ScanResult extends GroupingResult {
  probedCount: number;
  /** 走査に成功したルート(保存形。project.json の mediaRoots と同じ表記) */
  scannedRoots: string[];
  /** 解決できず走査をスキップしたルート(保存形) */
  missingRoots: string[];
}

/** mediaRoot 解決の結果(純関数。実 FS へは opts.exists 経由でのみアクセス) */
export interface ScanRootResolution {
  /** 実際に走査する実パス(resolveMediaRoot 済み) */
  resolvedRoots: string[];
  /** 走査に成功したルートの保存形(mediaRoots の要素そのもの) */
  scannedRoots: string[];
  /** 解決できなかったルートの保存形 */
  missingRoots: string[];
}

/**
 * 保存形の mediaRoots を実パスへ解決する純関数。
 * 1. mounts 対応表(root → このマシンでのマウント先)を適用
 * 2. resolveMediaRoot で実在確認(WSL 上の Windows パスは /mnt/<drive>/ へ自動変換)
 * mounts に対応が無いルートは素通しするので、同一マシンでの再スキャン(対応表なし)でも従来通り動く。
 */
export function resolveScanRoots(
  mediaRoots: string[],
  mounts: MountMap,
  opts: { platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {},
): ScanRootResolution {
  const resolvedRoots: string[] = [];
  const scannedRoots: string[] = [];
  const missingRoots: string[] = [];
  for (const root of mediaRoots) {
    const mapped = resolveMediaPath(root, [root], mounts);
    const resolved = resolveMediaRoot(mapped, opts);
    if (resolved) {
      resolvedRoots.push(resolved);
      scannedRoots.push(root);
    } else {
      missingRoots.push(root);
    }
  }
  return { resolvedRoots, scannedRoots, missingRoots };
}

/**
 * mediaRoots を走査・ffprobe(並列 4)してグルーピングする。
 * onProgress(probed, total) でジョブ進捗を更新。
 * mounts(cross-OS のマウント対応表)を渡すと、保存形ルートをこのマシンの実パスへ解決してから走査する。
 */
export async function scanMediaRoots(
  mediaRoots: string[],
  settings: ProjectSettings,
  ffprobePath: string,
  onProgress?: (probed: number, total: number) => void,
  mounts?: MountMap,
): Promise<ScanResult> {
  const { resolvedRoots, scannedRoots, missingRoots } = resolveScanRoots(mediaRoots, mounts ?? {});
  if (resolvedRoots.length === 0) {
    throw new Error(
      `メディアルートが見つかりません: ${missingRoots.join(' / ')}。` +
        `フォルダの存在とパスの綴りを確認してください` +
        (process.platform === 'linux' ? '(Windows パスは /mnt/<ドライブ>/ に自動変換して探しています)' : '') +
        '。別 OS で撮影した素材の場合は、設定→マウント対応表も確認してください。',
    );
  }
  if (missingRoots.length > 0) {
    console.warn(`[scan] 見つからないメディアルートをスキップ: ${missingRoots.join(' / ')}`);
  }

  // 全 mediaRoot を走査
  const found: FoundFile[] = [];
  for (const root of resolvedRoots) {
    found.push(...(await walkMediaRoot(root)));
  }
  // 重複パス除去(複数 root が重なる場合)
  const seen = new Set<string>();
  const unique = found.filter((f) => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
  if (unique.length === 0) {
    throw new Error(
      `動画ファイル(.mp4 / .mov / .m4v)が見つかりませんでした: ${resolvedRoots.join(' / ')}`,
    );
  }

  const total = unique.length;
  const probed: ProbedFile[] = [];
  let done = 0;
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = cursor++;
      if (idx >= unique.length) return;
      const f = unique[idx]!;
      try {
        const [meta, stat] = await Promise.all([ffprobe(f.path, ffprobePath), fsp.stat(f.path)]);
        probed.push({
          path: f.path,
          fileName: f.fileName,
          dir: f.dir,
          mediaRoot: f.mediaRoot,
          sizeBytes: stat.size,
          durationSec: meta.durationSec,
          createdAt: meta.createdAt,
          mtime: stat.mtime.toISOString(),
          width: meta.width,
          height: meta.height,
          videoCodec: meta.videoCodec,
          audioCodec: meta.audioCodec,
          fps: meta.fps,
          playableInBrowser: meta.playableInBrowser,
          gps: meta.gps,
        });
      } catch (e) {
        console.warn(`[scan] probe failed: ${f.path}: ${(e as Error).message}`);
      } finally {
        done++;
        onProgress?.(done, total);
      }
    }
  };

  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, () => worker()));

  // 走査・ffprobe・グルーピングまでは実パスのまま行う(cameraLabelOf が path.relative で
  // mediaRoot からの相対セグメントを見るため)。ここで初めて保存形パスへ戻す。
  const grouping = buildDaysAndClips(probed, settings);
  const clips = grouping.clips.map((c) => ({
    ...c,
    files: c.files.map((f) => ({ ...f, path: toStoredPath(f.path, mediaRoots, mounts ?? {}) })),
  }));
  return {
    days: grouping.days,
    clips,
    probedCount: probed.length,
    scannedRoots,
    missingRoots,
  };
}
