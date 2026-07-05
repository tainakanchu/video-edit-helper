import { describe, it, expect } from 'vitest';
import { download } from './download.js';

function mockResponse(
  bytes: Uint8Array,
  opts: { stream?: boolean; ok?: boolean; status?: number; noLength?: boolean } = {},
): Response {
  const ok = opts.ok ?? true;
  const headers = new Headers();
  if (!opts.noLength) headers.set('content-length', String(bytes.length));
  const body = opts.stream
    ? new ReadableStream<Uint8Array>({
        start(controller) {
          const mid = Math.floor(bytes.length / 2);
          controller.enqueue(bytes.subarray(0, mid));
          controller.enqueue(bytes.subarray(mid));
          controller.close();
        },
      })
    : null;
  return {
    ok,
    status: opts.status ?? (ok ? 200 : 500),
    statusText: ok ? 'OK' : 'ERR',
    headers,
    body,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

const fetchReturning = (res: Response): typeof fetch =>
  (async () => res) as unknown as typeof fetch;

describe('download', () => {
  it('body が無ければ arrayBuffer にフォールバックして取得する', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    let ratio = 0;
    const out = await download('http://x', {
      fetchImpl: fetchReturning(mockResponse(data, { stream: false })),
      onProgress: (r) => (ratio = r),
    });
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
    expect(ratio).toBe(1);
  });

  it('ストリームを読み切り、content-length に対する進捗を報告する', async () => {
    const data = new Uint8Array(Array.from({ length: 10 }, (_, i) => i));
    const ratios: number[] = [];
    const out = await download('http://x', {
      fetchImpl: fetchReturning(mockResponse(data, { stream: true })),
      onProgress: (r) => ratios.push(r),
    });
    expect(Array.from(out)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(ratios[ratios.length - 1]).toBe(1);
    // 2 チャンクなので中間進捗が少なくとも 1 回入る
    expect(ratios.length).toBeGreaterThanOrEqual(2);
  });

  it('レスポンスが ok でなければ例外を投げる', async () => {
    await expect(
      download('http://x', {
        fetchImpl: fetchReturning(mockResponse(new Uint8Array(), { ok: false, status: 404 })),
      }),
    ).rejects.toThrow(/404/);
  });
});
