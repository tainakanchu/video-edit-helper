// ffmpeg / ffprobe の static ビルドを取得して配置する。
// 取得元は ffmpeg-static(eugeneware)の GitHub Releases。
//   - darwin-arm64 / darwin-x64 / linux-(x64|arm64|ia32|arm) / win32-x64 を網羅
//   - Apple Silicon は arm64 ネイティブを取得する(Rosetta 廃止に備える)
//   - ffmpeg / ffprobe を gzip 単体バイナリで配布(展開は gunzip のみ)
// URL は VEH_FFMPEG_URL / VEH_FFPROBE_URL で上書き可(CI でのピン留め用)。
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'fflate';
import { download } from './download.js';
import type { EmitSetup } from './progress.js';

const FFSTATIC_BASE = 'https://github.com/eugeneware/ffmpeg-static/releases/download';
/** 取得するリリースタグ(ffmpeg 6.1.1)。更新時はここを上げる */
export const FFSTATIC_TAG = 'b6.1.1';

/**
 * process.platform/arch を ffmpeg-static のアセット名に対応づける。
 * 例: ('ffmpeg','darwin','arm64') → 'ffmpeg-darwin-arm64.gz'
 * ffmpeg-static は darwin/linux/win32 × arm64/x64/ia32/arm をそのまま使うため恒等対応。
 */
export function ffmpegStaticAssetName(
  name: 'ffmpeg' | 'ffprobe',
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${name}-${platform}-${arch}.gz`;
}

/** ffmpeg-static の取得 URL */
export function ffmpegStaticUrl(
  name: 'ffmpeg' | 'ffprobe',
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  return `${FFSTATIC_BASE}/${FFSTATIC_TAG}/${ffmpegStaticAssetName(name, platform, arch)}`;
}

export interface EnsureBinaryArgs {
  name: 'ffmpeg' | 'ffprobe';
  /** 配置先(絶対パス) */
  destPath: string;
  /** 取得元 .gz の URL */
  url: string;
  fetchImpl?: typeof fetch;
  emit?: EmitSetup;
}

/** destPath が無ければ .gz を取得・gunzip して配置する(unix は chmod 755) */
export async function ensureFfBinary(args: EnsureBinaryArgs): Promise<'installed' | 'exists'> {
  const { name, destPath, url, emit } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (fs.existsSync(destPath)) {
    emit?.({ phase: name, status: 'skip', progress: 1, message: `${name} は既に存在します` });
    return 'exists';
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  emit?.({ phase: name, status: 'downloading', progress: 0, message: `${name} をダウンロード中` });
  const gz = await download(url, {
    fetchImpl,
    onProgress: (r) => emit?.({ phase: name, status: 'downloading', progress: r }),
  });
  emit?.({ phase: name, status: 'extracting', message: `${name} を展開中` });
  const bin = gunzipSync(gz);
  // tmp に書いてから rename(中断時に壊れた実行ファイルを残さない)
  const tmp = `${destPath}.tmp`;
  fs.writeFileSync(tmp, bin);
  fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, destPath);
  emit?.({ phase: name, status: 'done', progress: 1, message: `${name} を配置しました` });
  return 'installed';
}
