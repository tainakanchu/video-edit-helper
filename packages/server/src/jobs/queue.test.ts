import { describe, expect, it } from 'vitest';
import { JobQueue } from './queue.js';

describe('JobQueue', () => {
  it('ジョブを実行して done になる', async () => {
    const q = new JobQueue();
    const info = q.enqueue('vad', async (ctx) => {
      ctx.setProgress(0.5);
    });
    await q.idle();
    const final = q.get(info.id)!;
    expect(final.status).toBe('done');
    expect(final.progress).toBe(1);
  });

  it('失敗は error + メッセージ、キューは継続', async () => {
    const q = new JobQueue();
    const bad = q.enqueue('vad', async () => {
      throw new Error('boom');
    });
    const good = q.enqueue('vad', async () => {});
    await q.idle();
    expect(q.get(bad.id)!.status).toBe('error');
    expect(q.get(bad.id)!.error).toBe('boom');
    expect(q.get(good.id)!.status).toBe('done');
  });

  it('優先度順に実行される(scan > thumbs-coarse > vad > thumbs-fine)', async () => {
    const q = new JobQueue();
    const order: string[] = [];
    // 同時実行 2 のため、最初の 2 件は即時起動される。
    // 検証を単純化するため、まず 2 件のブロッカーで枠を埋める。
    let release1!: () => void;
    let release2!: () => void;
    const block1 = new Promise<void>((r) => (release1 = r));
    const block2 = new Promise<void>((r) => (release2 = r));
    q.enqueue('scan', async () => {
      await block1;
    });
    q.enqueue('scan', async () => {
      await block2;
    });
    // 枠が埋まった状態で 3 種を投入(優先度で並ぶはず)
    q.enqueue('thumbs-fine', async () => {
      order.push('fine');
    });
    q.enqueue('vad', async () => {
      order.push('vad');
    });
    q.enqueue('thumbs-coarse', async () => {
      order.push('coarse');
    });
    // 枠を解放
    release1();
    release2();
    await q.idle();
    expect(order).toEqual(['coarse', 'vad', 'fine']);
  });

  it('list は新しい順', async () => {
    const q = new JobQueue();
    const a = q.enqueue('vad', async () => {});
    const b = q.enqueue('vad', async () => {});
    await q.idle();
    const ids = q.list().map((j) => j.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });
});
