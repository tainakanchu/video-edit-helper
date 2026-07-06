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
  /** 素材ルートの「このマシンでの実パス」対応表(ローカル・非同期)。cross-OS 解決用 */
  mountsFile: string;
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
  /** true なら Silero(onnxruntime-node)を使わず silencedetect を直接使う(パッケージ版の単一バイナリ用) */
  disableSilero: boolean;
  /** true なら起動時に ffmpeg/ffprobe・whisper モデルを自動取得する(パッケージ版) */
  autoProvision: boolean;
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
  // 大容量で再生成が容易なキャッシュ(サムネ・プロキシ)の置き場。
  // VEH_CACHE_DIR を指定するとローカルに分離でき、VEH_PROJECT_DIR を OneDrive 等に置いても
  // GB 級のプロキシまで同期せずに済む。未指定なら従来どおり projectDir/cache。
  const bulkyCacheDir = env.VEH_CACHE_DIR
    ? path.resolve(env.VEH_CACHE_DIR)
    : path.join(projectDir, 'cache');
  // 解析結果(文字起こし・シーン・VAD)は小さく再生成コストが高いので projectDir 側に置き、
  // project.json と一緒に同期できるようにする。
  const analysisDir = path.join(projectDir, 'cache');
  const config: Config = {
    projectDir,
    projectFile: path.join(projectDir, 'project.json'),
    // バックアップは大量のファイル生成/ローテーションで同期先を汚すため、
    // VEH_BACKUPS_DIR でローカル(非同期)へ分離できる。未指定なら従来どおり projectDir 配下。
    backupsDir: env.VEH_BACKUPS_DIR ? path.resolve(env.VEH_BACKUPS_DIR) : path.join(projectDir, 'backups'),
    thumbsDir: path.join(bulkyCacheDir, 'thumbs'),
    vadDir: path.join(analysisDir, 'vad'),
    proxiesDir: path.join(bulkyCacheDir, 'proxies'),
    transcriptsDir: path.join(analysisDir, 'transcripts'),
    scenesDir: path.join(analysisDir, 'scenes'),
    // 対応表はローカル(非同期)。既定は大容量キャッシュと同じローカル領域に置く
    mountsFile: env.VEH_MOUNTS_FILE ?? path.join(bulkyCacheDir, 'mounts.json'),
    port: env.PORT ? Number(env.PORT) : SERVER_PORT_DEFAULT,
    ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH ?? 'ffprobe',
    vadModelPath: env.VEH_VAD_MODEL ?? defaultVadModelPath(),
    whisperPath: env.WHISPER_PATH ?? 'whisper-cli',
    whisperModelPath: env.VEH_WHISPER_MODEL ?? defaultWhisperModelPath(),
    whisperThreads: env.WHISPER_THREADS ? Number(env.WHISPER_THREADS) : defaultWhisperThreads(),
    whisperLanguage: env.VEH_WHISPER_LANG ?? 'auto',
    webDistDir: env.VEH_WEB_DIST ?? defaultWebDistDir(),
    disableSilero: env.VEH_DISABLE_SILERO === '1' || env.VEH_DISABLE_SILERO === 'true',
    autoProvision: env.VEH_AUTO_PROVISION === '1' || env.VEH_AUTO_PROVISION === 'true',
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
