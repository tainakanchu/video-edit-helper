import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { SERVER_PORT_DEFAULT } from '@veh/shared';

/** サーバー全体の設定。環境変数から構築する */
export interface Config {
  /** プロジェクトデータの配置ディレクトリ(絶対パス) */
  projectDir: string;
  /** project.json の絶対パス */
  projectFile: string;
  /** 世代バックアップ格納ディレクトリ */
  backupsDir: string;
  /** サムネイルキャッシュ */
  thumbsDir: string;
  /** VAD 結果キャッシュ */
  vadDir: string;
  /** プロキシ(H.264)動画キャッシュ */
  proxiesDir: string;
  /** 文字起こし結果キャッシュ */
  transcriptsDir: string;
  /** シーン自動分割結果キャッシュ */
  scenesDir: string;
  port: number;
  ffmpegPath: string;
  ffprobePath: string;
  /** Silero VAD の ONNX モデルパス */
  vadModelPath: string;
  /** whisper-cli の実行パス */
  whisperPath: string;
  /** whisper モデル(ggml)のパス */
  whisperModelPath: string;
  /** whisper のスレッド数 */
  whisperThreads: number;
  /** whisper の言語指定('auto' で自動判定。合成音声等の誤判定時に 'ja' 等で固定) */
  whisperLanguage: string;
  /** ビルド済み Web UI(packages/web/dist)。存在すれば静的配信する */
  webDistDir: string;
}

/** packages/web/dist を import.meta.url 基準で解決 */
function defaultWebDistDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // server/src または server/dist 配下 → ../../web/dist
  return path.resolve(here, '..', '..', 'web', 'dist');
}

/** models/silero_vad.onnx を import.meta.url 基準で解決 */
function defaultVadModelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ または dist/ 配下 → 一つ上の models/
  return path.resolve(here, '..', 'models', 'silero_vad.onnx');
}

/** models/ggml-small.bin を import.meta.url 基準で解決 */
function defaultWhisperModelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ または dist/ 配下 → 一つ上の models/
  return path.resolve(here, '..', 'models', 'ggml-small.bin');
}

/** whisper のデフォルトスレッド数: CPU コア数 − 2(最低 2) */
function defaultWhisperThreads(): number {
  const cpus = os.cpus().length || 4;
  return Math.max(2, cpus - 2);
}

/** 環境変数から Config を構築する。ディレクトリは mkdir -p 済みにする */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const projectDir = path.resolve(env.VEH_PROJECT_DIR ?? './project-data');
  const config: Config = {
    projectDir,
    projectFile: path.join(projectDir, 'project.json'),
    backupsDir: path.join(projectDir, 'backups'),
    thumbsDir: path.join(projectDir, 'cache', 'thumbs'),
    vadDir: path.join(projectDir, 'cache', 'vad'),
    proxiesDir: path.join(projectDir, 'cache', 'proxies'),
    transcriptsDir: path.join(projectDir, 'cache', 'transcripts'),
    scenesDir: path.join(projectDir, 'cache', 'scenes'),
    port: env.PORT ? Number(env.PORT) : SERVER_PORT_DEFAULT,
    ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH ?? 'ffprobe',
    vadModelPath: env.VEH_VAD_MODEL ?? defaultVadModelPath(),
    whisperPath: env.WHISPER_PATH ?? 'whisper-cli',
    whisperModelPath: env.VEH_WHISPER_MODEL ?? defaultWhisperModelPath(),
    whisperThreads: env.WHISPER_THREADS ? Number(env.WHISPER_THREADS) : defaultWhisperThreads(),
    whisperLanguage: env.VEH_WHISPER_LANG ?? 'auto',
    webDistDir: env.VEH_WEB_DIST ?? defaultWebDistDir(),
  };
  for (const dir of [
    config.projectDir,
    config.backupsDir,
    config.thumbsDir,
    config.vadDir,
    config.proxiesDir,
    config.transcriptsDir,
    config.scenesDir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return config;
}
