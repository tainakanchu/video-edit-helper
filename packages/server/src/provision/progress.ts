// 初回セットアップ(依存取得)の進捗を 1 行 NDJSON で stdout に出力する。
// Tauri(Rust)側がこの `VEH_SETUP <json>` 行をパースして splash 画面に転送する。

export type SetupPhase = 'ffmpeg' | 'ffprobe' | 'model' | 'ready';
export type SetupStatus = 'downloading' | 'extracting' | 'done' | 'skip' | 'error';

export interface SetupEvent {
  phase: SetupPhase;
  status: SetupStatus;
  /** 0..1。不明なら省略 */
  progress?: number;
  message?: string;
}

/** Rust 側がこの接頭辞で始まる stdout 行をセットアップイベントとして解釈する */
export const SETUP_PREFIX = 'VEH_SETUP ';

export type EmitSetup = (ev: SetupEvent) => void;

/** stdout に `VEH_SETUP <json>` を 1 行で書き出すエミッタを作る */
export function makeStdoutEmitter(): EmitSetup {
  return (ev) => {
    process.stdout.write(SETUP_PREFIX + JSON.stringify(ev) + '\n');
  };
}
