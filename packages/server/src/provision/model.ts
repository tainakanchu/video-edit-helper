// whisper.cpp の ggml モデルを Hugging Face から取得して配置する。
import fs from 'node:fs';
import path from 'node:path';
import { download } from './download.js';
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
  emit?.({
    phase: 'model',
    status: 'downloading',
    progress: 0,
    message: `whisper モデル(${size ?? '?'})をダウンロード中`,
  });
  const bytes = await download(url, {
    fetchImpl,
    onProgress: (r) => emit?.({ phase: 'model', status: 'downloading', progress: r }),
  });
  if (bytes.length < 1000) {
    throw new Error(`whisper モデルのサイズが小さすぎます (${bytes.length} bytes)`);
  }
  const tmp = `${destPath}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, destPath);
  emit?.({ phase: 'model', status: 'done', progress: 1, message: 'whisper モデルを配置しました' });
  return 'installed';
}
