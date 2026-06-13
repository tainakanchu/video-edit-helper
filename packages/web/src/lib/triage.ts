/**
 * トリアージ(付箋の集中処理)のキュー進行ロジック(純ロジック・テスト対象)。
 *
 * Day 内の open 付箋を時系列で 1 件ずつ処理する。
 * - 昇格(promote)/ 破棄(discard): その付箋はキューから外れる(処理済み)。
 * - スキップ(skip): 後回し。キュー末尾へ回し、次へ進む。
 *
 * note の status は別途サーバー/ストアで更新される。ここではキューの
 * インデックス進行だけを純粋に計算する。
 */

import type { ID, Note } from '@veh/shared';

export interface TriageQueue {
  /** 処理対象の付箋 ID(時系列順、スキップで末尾へ回る) */
  order: ID[];
  /** 現在処理中のインデックス(order 内)。空なら 0 */
  index: number;
  /** 処理済み(昇格 or 破棄)になった付箋 ID 集合 */
  done: Set<ID>;
}

/** Day の open 付箋(timeSec 昇順)からキューを構築する */
export function buildTriageQueue(notes: Note[]): TriageQueue {
  const order = notes
    .filter((n) => n.status === 'open')
    .slice()
    .sort((a, b) => a.timeSec - b.timeSec)
    .map((n) => n.id);
  return { order, index: 0, done: new Set() };
}

/** 現在処理中の付箋 ID(なければ null) */
export function currentNoteId(q: TriageQueue): ID | null {
  return q.order[q.index] ?? null;
}

/** 残り件数(未処理。スキップ済みも残りに含む) */
export function remainingCount(q: TriageQueue): number {
  return q.order.filter((id) => !q.done.has(id)).length;
}

/** 処理済み件数 */
export function doneCount(q: TriageQueue): number {
  return q.done.size;
}

/** 全件処理済みか */
export function isComplete(q: TriageQueue): boolean {
  return remainingCount(q) === 0;
}

/**
 * 現在のインデックスから、次の「未処理」付箋のインデックスを探す。
 * order を循環して走査し、見つからなければ order.length(終端)を返す。
 */
function nextPendingIndex(order: ID[], done: Set<ID>, from: number): number {
  if (order.length === 0) return 0;
  const n = order.length;
  for (let step = 0; step < n; step++) {
    const i = (from + step) % n;
    const id = order[i]!;
    if (!done.has(id)) return i;
  }
  return order.length; // 全部 done
}

/** 昇格 or 破棄: 現在の付箋を done にして、次の未処理へ進む */
export function advanceProcessed(q: TriageQueue): TriageQueue {
  const cur = currentNoteId(q);
  if (cur === null) return q;
  const done = new Set(q.done);
  done.add(cur);
  // 現在位置の次から未処理を探す
  const index = nextPendingIndex(q.order, done, q.index + 1);
  return { order: q.order, index, done };
}

/**
 * スキップ: 現在の付箋を order 末尾へ回し、次の未処理へ進む(done にはしない)。
 * 1 件しか残っていない場合はその場に留まる。
 */
export function advanceSkip(q: TriageQueue): TriageQueue {
  const cur = currentNoteId(q);
  if (cur === null) return q;
  if (remainingCount(q) <= 1) return q; // 自分しか残っていない → 留まる

  const order = q.order.slice();
  order.splice(q.index, 1);
  order.push(cur);
  // splice で詰まったので、同じ index がそのまま「次の要素」を指す。
  // ただし末尾を超えた / そこが done の場合に備えて未処理を探す。
  const index = nextPendingIndex(order, q.done, q.index % Math.max(1, order.length));
  return { order, index, done: q.done };
}
