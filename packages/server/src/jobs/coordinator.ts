import type { Clip, JobType } from '@veh/shared';
import type { Config } from '../config.js';
import type { ProjectStore } from '../store/projectStore.js';
import { JobQueue } from './queue.js';
import { scanMediaRoots } from '../scan/scanner.js';
import { generateThumbs, thumbsComplete } from './thumbnails.js';
import { hasVadResult, runVadForClip, selectVadProvider } from './vad.js';
import { clipNeedsProxy, generateProxies, hasProxy, proxyComplete } from './proxy.js';
import { detectScenesForClip, hasScenes } from './scenes.js';
import { hasTranscript, transcribeClip } from './whisper.js';
import type { VadProvider } from '../vad/silencedetect.js';
import type { TranscriptCache } from '../search/transcriptCache.js';

/**
 * スキャン・サムネ・VAD・プロキシ・文字起こしのジョブを束ねるコーディネーター。
 * scan 完了時に thumbs-coarse → vad → thumbs-fine → proxy を自動投入する
 * (whisper は自動投入しない=enqueue API からのみ)。
 */
export class JobCoordinator {
  /** VAD プロバイダは遅延初期化(初回 VAD/whisper ジョブ時に選定) */
  private vadProvider: VadProvider | null = null;
  private vadProviderPromise: Promise<VadProvider> | null = null;
  /** whisper 完了時に検索キャッシュを無効化するためのフック(任意) */
  private transcriptCache: TranscriptCache | null = null;

  constructor(
    private readonly config: Config,
    private readonly store: ProjectStore,
    readonly queue: JobQueue,
  ) {}

  /** 検索用の Transcript キャッシュを登録(whisper 完了時に invalidate する) */
  setTranscriptCache(cache: TranscriptCache): void {
    this.transcriptCache = cache;
  }

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
      ctx.setMessage(`${result.probedCount} ファイル → ${result.clips.length} クリップ / ${result.days.length} 日`);
      // 全クリップに解析ジョブを自動投入(再スキャンマージ後の最新クリップを使う)
      this.autoEnqueueAnalysis(this.store.getAllClips());
    });
    return info.id;
  }

  /** scan 完了後の自動投入: thumbs-coarse → vad → thumbs-fine → proxy(成果物がある分はスキップ) */
  private autoEnqueueAnalysis(clips: Clip[]): void {
    this.enqueueAnalysis('thumbs-coarse', clips);
    this.enqueueAnalysis('vad', clips);
    this.enqueueAnalysis('thumbs-fine', clips);
    this.enqueueAnalysis('proxy', clips);
    // whisper は自動投入しない(夜間バッチとして UI から明示的にキューイング)
  }

  /** 解析ジョブを投入(クリップごとに 1 ジョブ)。完了済み成果物・対象外はスキップ */
  enqueueAnalysis(type: Exclude<JobType, 'scan'>, clips: Clip[]): string[] {
    const ids: string[] = [];
    for (const clip of clips) {
      if (this.shouldSkip(type, clip)) continue;
      const id = this.enqueueOne(type, clip);
      ids.push(id);
    }
    return ids;
  }

  /** 既に成果物がそろっている / 対象外ならスキップ */
  private shouldSkip(type: Exclude<JobType, 'scan'>, clip: Clip): boolean {
    const settings = this.store.getSettings();
    if (type === 'thumbs-coarse') {
      return thumbsComplete(this.config, clip, settings.thumbCoarseIntervalSec);
    }
    if (type === 'thumbs-fine') {
      return thumbsComplete(this.config, clip, settings.thumbFineIntervalSec);
    }
    if (type === 'vad') {
      return hasVadResult(this.config, clip.id);
    }
    if (type === 'proxy') {
      // 対象ファイルを含まない、または全て生成済みならスキップ
      // (proxyAllFiles=true なら再生可能ファイルも対象になる)
      return proxyComplete(this.config, clip, settings.proxyAllFiles);
    }
    if (type === 'scenes') {
      // シーン結果が生成済みならスキップ
      return hasScenes(this.config, clip.id);
    }
    // whisper: 生成済みならスキップ
    return hasTranscript(this.config, clip.id);
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
        } else if (type === 'vad') {
          const provider = await this.getVadProvider();
          ctx.setMessage(`vad: ${provider.name}`);
          await runVadForClip(this.config, provider, clip, (r) => ctx.setProgress(r));
        } else if (type === 'proxy') {
          await generateProxies(
            this.config,
            clip,
            (fileId) => {
              // 成功したファイルごとにフラグを永続化
              this.store.setProxyAvailable(fileId, true);
            },
            (r) => ctx.setProgress(r),
            (m) => ctx.setMessage(m),
            settings.proxyAllFiles,
          );
        } else if (type === 'scenes') {
          await detectScenesForClip(
            this.config,
            clip,
            (r) => ctx.setProgress(r),
            (m) => ctx.setMessage(m),
          );
        } else {
          // whisper
          const provider = await this.getVadProvider();
          await transcribeClip(this.config, provider, clip, {
            onProgress: (r) => ctx.setProgress(r),
            onMessage: (m) => ctx.setMessage(m),
          });
          // 検索キャッシュを無効化して次回再ロードさせる
          this.transcriptCache?.invalidate(clip.id);
        }
      },
      clip.id,
    );
    return info.id;
  }

  /**
   * 起動時にプロキシディレクトリと突き合わせて proxyAvailable フラグを再同期する。
   * (生成済みプロキシがあるのにフラグが false / その逆 を補正)
   */
  syncProxyFlags(): void {
    for (const clip of this.store.getAllClips()) {
      for (const f of clip.files) {
        // 再生可能ファイルでもプロキシが実在 / フラグありなら同期対象にする
        // (proxyAllFiles 運用で生成された再生可能ファイルのプロキシも拾うため)
        if (f.playableInBrowser && !f.proxyAvailable && !hasProxy(this.config, f.id)) {
          continue;
        }
        const present = hasProxy(this.config, f.id);
        if (present && !f.proxyAvailable) {
          this.store.setProxyAvailable(f.id, true);
        } else if (!present && f.proxyAvailable) {
          this.store.setProxyAvailable(f.id, false);
        }
      }
    }
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

// clipNeedsProxy はルート側でも利用するため再エクスポート
export { clipNeedsProxy };
