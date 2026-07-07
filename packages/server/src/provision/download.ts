// content-length があれば進捗付きで URL を取得する。
import fs from 'node:fs';
import path from 'node:path';

export interface DownloadOpts {
  /** テスト用に差し替え可能 */
  fetchImpl?: typeof fetch;
  /** 0..1 の進捗(content-length が取れる場合のみ呼ばれる) */
  onProgress?: (ratio: number) => void;
}

/** URL を取得して Uint8Array で返す。失敗時は例外 */
export async function download(url: string, opts: DownloadOpts = {}): Promise<Uint8Array> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`ダウンロード失敗 ${res.status} ${res.statusText}: ${url}`);
  }
  const lenHeader = res.headers.get('content-length');
  const total = lenHeader ? Number(lenHeader) : 0;

  // body ストリームが無ければ一括取得にフォールバック
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    opts.onProgress?.(1);
    return buf;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (total > 0) opts.onProgress?.(Math.min(1, received / total));
    }
  }
  const out = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  opts.onProgress?.(1);
  return out;
}

/**
 * URL をディスクへ逐次ストリーム保存する(全体をメモリに載せない)。
 * whisper モデル(約 466MB)のような大きいファイルでも安定して落とせる。失敗時は例外。
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  opts: DownloadOpts = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`ダウンロード失敗 ${res.status} ${res.statusText}: ${url}`);
  }
  const lenHeader = res.headers.get('content-length');
  const total = lenHeader ? Number(lenHeader) : 0;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  // body ストリームが無ければ一括取得にフォールバック
  if (!res.body) {
    await fs.promises.writeFile(destPath, new Uint8Array(await res.arrayBuffer()));
    opts.onProgress?.(1);
    return;
  }

  const reader = res.body.getReader();
  const ws = fs.createWriteStream(destPath);
  // 書き込みエラーはいつでも起こりうるので race で拾い、ハングを防ぐ
  let rejectErr!: (e: Error) => void;
  const errored = new Promise<never>((_, reject) => {
    rejectErr = reject;
  });
  ws.on('error', rejectErr);

  let received = 0;
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), errored]);
      if (chunk.done) break;
      const value = chunk.value;
      if (!value) continue;
      received += value.length;
      if (total > 0) opts.onProgress?.(Math.min(1, received / total));
      // バックプレッシャ: バッファが一杯なら drain を待つ(メモリ肥大を防ぐ)
      if (!ws.write(value)) {
        await Promise.race([new Promise<void>((resolve) => ws.once('drain', resolve)), errored]);
      }
    }
    await Promise.race([new Promise<void>((resolve) => ws.end(() => resolve())), errored]);
  } catch (e) {
    ws.destroy();
    throw e;
  }
  opts.onProgress?.(1);
}
