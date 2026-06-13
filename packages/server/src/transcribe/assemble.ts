import type { TranscriptSegment } from '@veh/shared';

/** assembleSegments の入力: ブロック単位の whisper 結果 */
export interface BlockResult {
  /** クリップ通しタイムコード上のブロック開始秒 */
  blockStartSec: number;
  segments: { startSec: number; endSec: number; text: string }[];
}

/**
 * ブロック単位の whisper 結果をクリップ通しタイムコードに変換して
 * TranscriptSegment[] を返す純関数。
 * blockStartSec をオフセットとして加算し、start 昇順にソートする。
 */
export function assembleSegments(blocks: BlockResult[]): TranscriptSegment[] {
  const result: TranscriptSegment[] = [];
  for (const block of blocks) {
    for (const seg of block.segments) {
      const text = seg.text.trim();
      if (text === '') continue;
      result.push({
        start: block.blockStartSec + seg.startSec,
        end: block.blockStartSec + seg.endSec,
        text,
      });
    }
  }
  // start 昇順でソート（安定ソート: Array.prototype.sort は ES2019 以降安定）
  result.sort((a, b) => a.start - b.start);
  return result;
}
