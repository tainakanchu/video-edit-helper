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
  port: number;
  ffmpegPath: string;
  ffprobePath: string;
  /** Silero VAD の ONNX モデルパス */
  vadModelPath: string;
}

/** models/silero_vad.onnx を import.meta.url 基準で解決 */
function defaultVadModelPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/ または dist/ 配下 → 一つ上の models/
  return path.resolve(here, '..', 'models', 'silero_vad.onnx');
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
    port: env.PORT ? Number(env.PORT) : SERVER_PORT_DEFAULT,
    ffmpegPath: env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH ?? 'ffprobe',
    vadModelPath: env.VEH_VAD_MODEL ?? defaultVadModelPath(),
  };
  for (const dir of [config.projectDir, config.backupsDir, config.thumbsDir, config.vadDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return config;
}
