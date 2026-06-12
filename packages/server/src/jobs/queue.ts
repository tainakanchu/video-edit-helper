import { nanoid } from 'nanoid';
import type { ID, JobInfo, JobStatus, JobType } from '@veh/shared';

const MAX_CONCURRENCY = 2;
const HISTORY_LIMIT = 200;
const PROGRESS_THROTTLE_MS = 500;

/** 優先度(小さいほど先): scan > thumbs-coarse > vad > thumbs-fine */
const PRIORITY: Record<JobType, number> = {
  scan: 0,
  'thumbs-coarse': 1,
  vad: 2,
  'thumbs-fine': 3,
};

/** ジョブ実行時に渡されるコンテキスト */
export interface JobContext {
  /** progress(0..1)を更新(500ms スロットル) */
  setProgress(ratio: number): void;
  setMessage(message: string): void;
}

/** ジョブの実処理 */
export type JobRunner = (ctx: JobContext) => Promise<void>;

interface QueuedJob {
  info: JobInfo;
  runner: JobRunner;
  /** FIFO 安定化用の投入順 */
  seq: number;
}

/** メモリ内ジョブキュー。同時実行 2・優先度付き・直近 200 件保持 */
export class JobQueue {
  private pending: QueuedJob[] = [];
  private active = new Set<QueuedJob>();
  /** 完了/エラー含む全履歴(投入順) */
  private history: QueuedJob[] = [];
  private seqCounter = 0;
  private running = 0;

  /** ジョブを投入。runner は実処理 */
  enqueue(type: JobType, runner: JobRunner, clipId?: ID): JobInfo {
    const info: JobInfo = {
      id: nanoid(12),
      type,
      ...(clipId ? { clipId } : {}),
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString(),
    };
    const job: QueuedJob = { info, runner, seq: this.seqCounter++ };
    this.pending.push(job);
    this.history.push(job);
    this.trimHistory();
    this.pump();
    return info;
  }

  /** 全ジョブ情報(新しい順) */
  list(): JobInfo[] {
    return this.history
      .slice()
      .sort((a, b) => b.seq - a.seq)
      .map((j) => j.info);
  }

  get(id: ID): JobInfo | undefined {
    return this.history.find((j) => j.info.id === id)?.info;
  }

  /** アクティブ + 保留が無くなるまで待つ(テスト用) */
  async idle(): Promise<void> {
    while (this.running > 0 || this.pending.length > 0) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private trimHistory(): void {
    if (this.history.length > HISTORY_LIMIT) {
      // 完了済みの古いものから削除(保留/実行中は残す)
      const removable = this.history.filter(
        (j) => j.info.status === 'done' || j.info.status === 'error' || j.info.status === 'canceled',
      );
      const toRemove = this.history.length - HISTORY_LIMIT;
      const removeSet = new Set(removable.slice(0, toRemove));
      this.history = this.history.filter((j) => !removeSet.has(j));
    }
  }

  /** 空きがあれば優先度順に次のジョブを起動 */
  private pump(): void {
    while (this.running < MAX_CONCURRENCY && this.pending.length > 0) {
      this.pending.sort((a, b) => {
        const pa = PRIORITY[a.info.type];
        const pb = PRIORITY[b.info.type];
        if (pa !== pb) return pa - pb;
        return a.seq - b.seq; // 同種は FIFO
      });
      const job = this.pending.shift()!;
      void this.runJob(job);
    }
  }

  private async runJob(job: QueuedJob): Promise<void> {
    this.running++;
    this.active.add(job);
    job.info.status = 'running';
    job.info.startedAt = new Date().toISOString();

    let lastProgressAt = 0;
    const ctx: JobContext = {
      setProgress: (ratio: number) => {
        const now = Date.now();
        // 1.0 は必ず反映、それ以外は 500ms スロットル
        if (ratio >= 1 || now - lastProgressAt >= PROGRESS_THROTTLE_MS) {
          job.info.progress = Math.min(1, Math.max(0, ratio));
          lastProgressAt = now;
        }
      },
      setMessage: (message: string) => {
        job.info.message = message;
      },
    };

    try {
      await job.runner(ctx);
      job.info.status = 'done';
      job.info.progress = 1;
    } catch (e) {
      job.info.status = 'error';
      job.info.error = (e as Error).message;
    } finally {
      job.info.finishedAt = new Date().toISOString();
      this.active.delete(job);
      this.running--;
      this.pump();
    }
  }
}

export type { JobStatus };
