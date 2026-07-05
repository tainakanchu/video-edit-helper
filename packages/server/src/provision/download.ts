// content-length があれば進捗付きで URL を取得して Uint8Array を返す。

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
