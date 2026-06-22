import fs from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { ensureFfBinary, ffmpegStaticUrl } from './ffmpeg.js';
import { ensureWhisperModel } from './model.js';
import { makeStdoutEmitter, type EmitSetup } from './progress.js';

export type { EmitSetup, SetupEvent } from './progress.js';
export { SETUP_PREFIX, makeStdoutEmitter } from './progress.js';

/**
 * パッケージ版の起動時に外部依存(ffmpeg/ffprobe)と whisper モデルを用意する。
 * - config.autoProvision が false なら何もしない(dev は nix/PATH を使うため)
 * - ffmpeg/ffprobe は configのパスが「絶対パスかつ未存在」のときだけ取得(PATH 運用時はスキップ)
 * - whisper モデルは config.whisperModelPath が未存在のとき取得
 * 進捗は emit(既定は stdout NDJSON)で報告する。失敗時は例外を投げる。
 */
export async function ensureDependencies(
  config: Config,
  emit: EmitSetup = makeStdoutEmitter(),
): Promise<void> {
  if (!config.autoProvision) return;

  const needFfmpeg = path.isAbsolute(config.ffmpegPath) && !fs.existsSync(config.ffmpegPath);
  const needFfprobe = path.isAbsolute(config.ffprobePath) && !fs.existsSync(config.ffprobePath);

  if (needFfmpeg) {
    // VEH_FFMPEG_URL があれば優先(CI ピン留め)。既定は ffmpeg-static(arm64 ネイティブ含む)
    const url = process.env.VEH_FFMPEG_URL ?? ffmpegStaticUrl('ffmpeg');
    await ensureFfBinary({ name: 'ffmpeg', destPath: config.ffmpegPath, url, emit });
  }
  if (needFfprobe) {
    const url = process.env.VEH_FFPROBE_URL ?? ffmpegStaticUrl('ffprobe');
    await ensureFfBinary({ name: 'ffprobe', destPath: config.ffprobePath, url, emit });
  }

  // whisper モデル(未存在時のみ取得)
  await ensureWhisperModel({ destPath: config.whisperModelPath, emit });

  emit({ phase: 'ready', status: 'done', progress: 1, message: '準備完了' });
}
