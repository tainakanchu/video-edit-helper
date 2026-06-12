import type { Clip, JobType } from '@veh/shared';
import type { Config } from '../config.js';
import type { ProjectStore } from '../store/projectStore.js';
import { JobQueue } from './queue.js';
import { scanMediaRoots } from '../scan/scanner.js';
import { generateThumbs, thumbsComplete } from './thumbnails.js';
import { hasVadResult, runVadForClip, selectVadProvider } from './vad.js';
import type { VadProvider } from '../vad/silencedetect.js';

/**
 * スキャン・サムネ・VAD のジョブを束ねるコーディネーター。
 * scan 完了時に thumbs-coarse → vad → thumbs-fine を自動投入する。
 */
export class JobCoordinator {
  /** VAD プロバイダは遅延初期化(初回 VAD ジョブ時に選定) */
  private vadProvider: VadProvider | null = null;
  private vadProviderPromise: Promise<VadProvider> | null = null;

  constructor(
    private readonly config: Config,
    private readonly store: ProjectStore,
    readonly queue: JobQueue,
  ) {}

  /** スキャンジョブを投入。完了後に解析ジョブを自動投入 */
  enqueueScan(mediaRoots: string[]): string {
    const info = this.queue.enqueue('scan', async (ctx) => {
      ctx.setMessage('スキャン中');
      const result = await scanMediaRoots(
        mediaRoots,
        this.store.getSettings(),
        this.config.ffprobePath,
        (probed, total) => {
          ctx.setProgress(total > 0 ? probed / total : 1);
          ctx.setMessage(`probed ${probed}/${total}`);
        },
      );
      this.store.replaceScanResult(result.days, result.clips);
      ctx.setProgress(1);
      // 全クリップに解析ジョブを自動投入
      this.autoEnqueueAnalysis(result.clips);
    });
    return info.id;
  }

  /** scan 完了後の自動投入: thumbs-coarse → vad → thumbs-fine(成果物がある分はスキップ) */
  private autoEnqueueAnalysis(clips: Clip[]): void {
    this.enqueueAnalysis('thumbs-coarse', clips);
    this.enqueueAnalysis('vad', clips);
    this.enqueueAnalysis('thumbs-fine', clips);
  }

  /** 解析ジョブを投入(クリップごとに 1 ジョブ)。完了済み成果物はスキップ */
  enqueueAnalysis(type: Exclude<JobType, 'scan'>, clips: Clip[]): string[] {
    const ids: string[] = [];
    for (const clip of clips) {
      if (this.shouldSkip(type, clip)) continue;
      const id = this.enqueueOne(type, clip);
      ids.push(id);
    }
    return ids;
  }

  /** 既に成果物がそろっていればスキップ */
  private shouldSkip(type: Exclude<JobType, 'scan'>, clip: Clip): boolean {
    const settings = this.store.getSettings();
    if (type === 'thumbs-coarse') {
      return thumbsComplete(this.config, clip, settings.thumbCoarseIntervalSec);
    }
    if (type === 'thumbs-fine') {
      return thumbsComplete(this.config, clip, settings.thumbFineIntervalSec);
    }
    // vad
    return hasVadResult(this.config, clip.id);
  }

  private enqueueOne(type: Exclude<JobType, 'scan'>, clip: Clip): string {
    const settings = this.store.getSettings();
    const info = this.queue.enqueue(
      type,
      async (ctx) => {
        if (type === 'thumbs-coarse') {
          await generateThumbs(this.config, clip, settings.thumbCoarseIntervalSec, (r) =>
            ctx.setProgress(r),
          );
        } else if (type === 'thumbs-fine') {
          await generateThumbs(this.config, clip, settings.thumbFineIntervalSec, (r) =>
            ctx.setProgress(r),
          );
        } else {
          const provider = await this.getVadProvider();
          ctx.setMessage(`vad: ${provider.name}`);
          await runVadForClip(this.config, provider, clip, (r) => ctx.setProgress(r));
        }
      },
      clip.id,
    );
    return info.id;
  }

  /** VAD プロバイダを一度だけ選定する */
  private getVadProvider(): Promise<VadProvider> {
    if (this.vadProvider) return Promise.resolve(this.vadProvider);
    if (!this.vadProviderPromise) {
      this.vadProviderPromise = selectVadProvider(this.config).then((p) => {
        this.vadProvider = p;
        return p;
      });
    }
    return this.vadProviderPromise;
  }
}
