import type { Transcript } from '@veh/shared';
import type { Config } from '../config.js';
import { readTranscript } from '../jobs/whisper.js';

/**
 * 文字起こし結果のメモリキャッシュ。
 * 横断検索で全クリップの Transcript を毎回ディスクから読むのを避けるため、
 * clipId 単位で遅延ロードしてキャッシュする。
 * whisper ジョブ完了時に invalidate して次回再ロードさせる。
 */
export class TranscriptCache {
  private readonly cache = new Map<string, Transcript | null>();

  constructor(private readonly config: Config) {}

  /** clipId の Transcript を取得(未ロードならディスクから読む)。無ければ null */
  async get(clipId: string): Promise<Transcript | null> {
    if (this.cache.has(clipId)) {
      return this.cache.get(clipId) ?? null;
    }
    const t = await readTranscript(this.config, clipId);
    this.cache.set(clipId, t);
    return t;
  }

  /** キャッシュを破棄して次回再ロードさせる(whisper 完了時に呼ぶ) */
  invalidate(clipId: string): void {
    this.cache.delete(clipId);
  }

  /** 全キャッシュ破棄 */
  clear(): void {
    this.cache.clear();
  }
}
