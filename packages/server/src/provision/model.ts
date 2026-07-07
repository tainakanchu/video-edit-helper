// whisper.cpp の ggml モデルを Hugging Face から取得して配置する。
import fs from 'node:fs';
import path from 'node:path';
import { downloadToFile } from './download.js';
import type { EmitSetup } from './progress.js';

/** 'ggml-small.bin' → 'small'。パターン不一致なら null */
export function whisperSizeFromPath(modelPath: string): string | null {
  const base = path.basename(modelPath);
  const m = /^ggml-(.+)\.bin$/.exec(base);
  return m ? m[1]! : null;
}

/** モデルサイズ(small / base / medium / large-v3-turbo 等)から HF の URL を作る */
export function whisperModelUrl(size: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${size}.bin`;
}

export interface EnsureModelArgs {
  /** 配置先(絶対パス。例: <data>/models/ggml-small.bin) */
  destPath: string;
  /** 取得元を明示する場合(省略時は destPath のファイル名からサイズを推定) */
  url?: string;
  fetchImpl?: typeof fetch;
  emit?: EmitSetup;
}

/** destPath が無ければモデルを取得して配置する */
export async function ensureWhisperModel(
  args: EnsureModelArgs,
): Promise<'installed' | 'exists'> {
  const { destPath, emit } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    emit?.({ phase: 'model', status: 'skip', progress: 1, message: 'whisper モデルは既に存在します' });
    return 'exists';
  }
  const size = whisperSizeFromPath(destPath);
  const url = args.url ?? (size ? whisperModelUrl(size) : undefined);
  if (!url) {
    throw new Error(`whisper モデルの取得 URL を決定できません: ${destPath}`);
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // 466MB 級なのでメモリに載せずディスクへ逐次保存し、通信の一時的な失敗はリトライする。
  const tmp = `${destPath}.part`;
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      emit?.({
        phase: 'model',
        status: 'downloading',
        progress: 0,
        message:
          attempt > 1
            ? `whisper モデルを再取得中 (${attempt}/${MAX_ATTEMPTS})`
            : `whisper モデル(${size ?? '?'})をダウンロード中`,
      });
      await downloadToFile(url, tmp, {
        fetchImpl,
        onProgress: (r) => emit?.({ phase: 'model', status: 'downloading', progress: r }),
      });
      const written = fs.statSync(tmp).size;
      if (written < 1000) {
        throw new Error(`whisper モデルのサイズが小さすぎます (${written} bytes)`);
      }
      fs.renameSync(tmp, destPath);
      emit?.({ phase: 'model', status: 'done', progress: 1, message: 'whisper モデルを配置しました' });
      return 'installed';
    } catch (e) {
      lastErr = e;
      try {
        fs.rmSync(tmp, { force: true }); // 壊れた途中ファイルを消してから再試行
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('whisper モデルの取得に失敗しました');
}
