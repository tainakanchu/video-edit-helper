import type { Note, SearchResultItem, Selection, TranscriptSegment } from '@veh/shared';

/** searchAll に渡す入力 */
export interface SearchInputs {
  query: string;
  notes: Note[];
  selections: Selection[];
  transcripts: { clipId: string; segments: TranscriptSegment[] }[];
  /** clipId からその Day・クリップ名を解決するリゾルバ。不明なら undefined */
  clipMeta: (clipId: string) => { dayId: string; clipName: string } | undefined;
}

/** 最大返却件数 */
const MAX_RESULTS = 100;

/**
 * Note / Selection / Transcript セグメントを横断して
 * クエリに一致するアイテムを返す純関数。
 *
 * - クエリはトリム・小文字化して部分一致検索
 * - 空クエリ → []
 * - clipMeta が undefined を返す clipId はスキップ
 * - 結果は dayId → clipName → timeSec の昇順にソート
 * - 最大 MAX_RESULTS(100) 件に切り捨て
 */
export function searchAll(inputs: SearchInputs): SearchResultItem[] {
  const q = inputs.query.trim().toLowerCase();
  if (q === '') return [];

  const results: SearchResultItem[] = [];

  // Note 検索
  for (const note of inputs.notes) {
    const textMatch = note.text.toLowerCase().includes(q);
    const tagMatch = note.tags.some((t) => t.toLowerCase().includes(q));
    if (!textMatch && !tagMatch) continue;

    const meta = inputs.clipMeta(note.clipId);
    if (!meta) continue;

    // text が空の場合は tags をフォールバックとして表示
    const displayText = note.text !== '' ? note.text : note.tags.map((t) => `#${t}`).join(' ');

    results.push({
      kind: 'note',
      clipId: note.clipId,
      dayId: meta.dayId,
      clipName: meta.clipName,
      timeSec: note.timeSec,
      text: displayText,
    });
  }

  // Selection 検索
  for (const sel of inputs.selections) {
    const textMatch = sel.text.toLowerCase().includes(q);
    const tagMatch = sel.tags.some((t) => t.toLowerCase().includes(q));
    if (!textMatch && !tagMatch) continue;

    const meta = inputs.clipMeta(sel.clipId);
    if (!meta) continue;

    const displayText = sel.text !== '' ? sel.text : sel.tags.map((t) => `#${t}`).join(' ');

    results.push({
      kind: 'selection',
      clipId: sel.clipId,
      dayId: meta.dayId,
      clipName: meta.clipName,
      timeSec: sel.inSec,
      endSec: sel.outSec,
      text: displayText,
    });
  }

  // Transcript 検索
  for (const transcript of inputs.transcripts) {
    for (const seg of transcript.segments) {
      if (!seg.text.toLowerCase().includes(q)) continue;

      const meta = inputs.clipMeta(transcript.clipId);
      if (!meta) continue;

      results.push({
        kind: 'transcript',
        clipId: transcript.clipId,
        dayId: meta.dayId,
        clipName: meta.clipName,
        timeSec: seg.start,
        endSec: seg.end,
        text: seg.text,
      });
    }
  }

  // ソート: dayId → clipName → timeSec 昇順
  results.sort((a, b) => {
    const d = a.dayId.localeCompare(b.dayId);
    if (d !== 0) return d;
    const c = a.clipName.localeCompare(b.clipName);
    if (c !== 0) return c;
    return a.timeSec - b.timeSec;
  });

  return results.slice(0, MAX_RESULTS);
}
