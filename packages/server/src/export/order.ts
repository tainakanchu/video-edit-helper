import type { Clip, Selection } from '@veh/shared';

/** 選定リストをラフカット順に並べる */
export function orderSelections(
  selections: Selection[],
  clipById: (clipId: string) => Clip | undefined,
): Selection[] {
  // クリップが解決できない選定を除外
  const resolved = selections.filter(s => clipById(s.clipId) !== undefined);

  // recordedAt → inSec → id でソート (暗黙インデックス付与用)
  const sorted = [...resolved].sort((a, b) => {
    const clipA = clipById(a.clipId)!;
    const clipB = clipById(b.clipId)!;
    const timeDiff = Date.parse(clipA.recordedAt) - Date.parse(clipB.recordedAt);
    if (timeDiff !== 0) return timeDiff;
    const inDiff = a.inSec - b.inSec;
    if (inDiff !== 0) return inDiff;
    return a.id.localeCompare(b.id);
  });

  // 暗黙インデックスを付与して最終ソートキーで並べ直す
  return sorted
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const keyA = a.s.orderKey ?? a.i;
      const keyB = b.s.orderKey ?? b.i;
      if (keyA !== keyB) return keyA - keyB;
      // 同じキー値の場合: 明示的な orderKey を持つ方を優先
      const hasKeyA = a.s.orderKey !== null;
      const hasKeyB = b.s.orderKey !== null;
      if (hasKeyA !== hasKeyB) return hasKeyA ? -1 : 1;
      // 安定タイブレーク
      return a.i - b.i;
    })
    .map(({ s }) => s);
}
