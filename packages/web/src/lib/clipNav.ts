/**
 * クリップビュー間の「次 / 前のクリップ」ジャンプ先を求める純ロジック(テスト対象・DOM 非依存)。
 *
 * 全体の並び順は「project.days(日付昇順)と各 day.clipIds(recordedAt 昇順)を連結した列」。
 * Day 境界はまたぐ(ある Day の最後の次は次の Day の先頭)が、全体の先頭 / 末尾ではラップしない。
 */

import type { Day, ID } from '@veh/shared';

export interface AdjacentClipIds {
  prevId: ID | null;
  nextId: ID | null;
}

/** 現在クリップの次 / 前のクリップ ID を返す。存在しない ID を渡した場合は両方 null */
export function adjacentClipIds(days: Day[], currentClipId: ID): AdjacentClipIds {
  const order = days.flatMap((d) => d.clipIds);
  const i = order.indexOf(currentClipId);
  if (i === -1) return { prevId: null, nextId: null };

  return {
    prevId: i > 0 ? order[i - 1]! : null,
    nextId: i < order.length - 1 ? order[i + 1]! : null,
  };
}
