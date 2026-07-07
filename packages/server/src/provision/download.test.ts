import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download, downloadToFile } from './download.js';

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

describe('downloadToFile', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function dest(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-dl-'));
    tmpDirs.push(d);
    return path.join(d, 'out.bin');
  }

  it('ストリームをメモリに載せずディスクへ保存する(進捗報告つき)', async () => {
    const data = new Uint8Array(Array.from({ length: 20 }, (_, i) => i));
    const out = dest();
    const ratios: number[] = [];
    await downloadToFile('http://x', out, {
      fetchImpl: fetchReturning(mockResponse(data, { stream: true })),
      onProgress: (r) => ratios.push(r),
    });
    expect(Array.from(fs.readFileSync(out))).toEqual(Array.from(data));
    expect(ratios[ratios.length - 1]).toBe(1);
  });

  it('body 無しは arrayBuffer にフォールバックして保存', async () => {
    const data = new Uint8Array([9, 8, 7]);
    const out = dest();
    await downloadToFile('http://x', out, {
      fetchImpl: fetchReturning(mockResponse(data, { stream: false })),
    });
    expect(Array.from(fs.readFileSync(out))).toEqual([9, 8, 7]);
  });

  it('ok でなければ例外', async () => {
    await expect(
      downloadToFile('http://x', dest(), {
        fetchImpl: fetchReturning(mockResponse(new Uint8Array(), { ok: false, status: 500 })),
      }),
    ).rejects.toThrow(/500/);
  });
});
