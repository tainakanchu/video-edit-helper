import { addRange, type TimeRange } from '@veh/shared';

/**
 * 視聴済みレンジのトラッキング(純ロジック)。
 *
 * video の timeupdate(約 4Hz)から呼ばれる `track()` で状態を更新する。
 * - 連続再生中は現在オープン中のレンジを伸ばす。
 * - 直前報告時刻からのジャンプが `max(2, playbackRate * 2)` 秒を超えたら
 *   シークとみなし、現在レンジを閉じて新しいレンジを開始する。
 * - 一時停止 / 後退 / クリップ離脱時も現在レンジを閉じる。
 *
 * 「確定済みレンジ(committed)」と「現在オープン中レンジ(open)」を分けて持ち、
 * flush 時に open を確定して committed にマージし、未送信分だけを返せるようにする。
 */
export interface WatchedTrackerState {
  /** flush 済みも含むローカルの確定レンジ(正規化済み・昇順) */
  committed: TimeRange[];
  /** 現在伸長中のレンジ(まだ確定していない) */
  open: TimeRange | null;
  /** 直近に track() で受け取った仮想時刻(ジャンプ判定に使う) */
  lastTime: number | null;
}

export function createWatchedState(initial: TimeRange[] = []): WatchedTrackerState {
  return {
    committed: normalize(initial),
    open: null,
    lastTime: null,
  };
}

function normalize(ranges: TimeRange[]): TimeRange[] {
  // addRange は正規化を行うので、空配列に順次足して正規化済みリストを得る
  let acc: TimeRange[] = [];
  for (const r of ranges) acc = addRange(acc, r);
  return acc;
}

/** シーク(連続再生でないジャンプ)とみなす閾値秒 */
export function seekThreshold(playbackRate: number): number {
  const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
  return Math.max(2, rate * 2);
}

/**
 * 1 フレーム分の更新。新しい state を返す(元の state は変更しない)。
 *
 * @param state           現在の状態
 * @param currentVirtualTime 現在の仮想時刻(クリップ通し秒)
 * @param playing         再生中か
 * @param playbackRate    再生速度
 */
export function track(
  state: WatchedTrackerState,
  currentVirtualTime: number,
  playing: boolean,
  playbackRate: number,
): WatchedTrackerState {
  const t = currentVirtualTime;
  if (!Number.isFinite(t)) return state;

  // 停止中: オープン中レンジを閉じ、時刻だけ覚える
  if (!playing) {
    if (state.open) {
      return {
        committed: addRange(state.committed, state.open),
        open: null,
        lastTime: t,
      };
    }
    return state.lastTime === t ? state : { ...state, lastTime: t };
  }

  const threshold = seekThreshold(playbackRate);
  const prev = state.lastTime;

  // オープン中レンジが無い → 新規に開始
  if (!state.open) {
    return { committed: state.committed, open: { start: t, end: t }, lastTime: t };
  }

  // 連続再生の判定: 前回時刻から閾値以内の「前進」なら同じレンジを伸ばす
  const isContinuous =
    prev !== null && t >= prev - 0.001 && t - prev <= threshold;

  if (isContinuous) {
    const open = { start: state.open.start, end: Math.max(state.open.end, t) };
    return { committed: state.committed, open, lastTime: t };
  }

  // シーク(または後退): 現在のオープンレンジを確定し、新レンジを開始
  return {
    committed: addRange(state.committed, state.open),
    open: { start: t, end: t },
    lastTime: t,
  };
}

/** オープン中レンジを確定して committed にマージした state を返す(flush 用) */
export function commitOpen(state: WatchedTrackerState): WatchedTrackerState {
  if (!state.open) return state;
  return {
    committed: addRange(state.committed, state.open),
    open: null,
    lastTime: state.lastTime,
  };
}

/** UI 表示用: 確定 + オープン中を合算した現在の視聴レンジ */
export function effectiveRanges(state: WatchedTrackerState): TimeRange[] {
  if (!state.open) return state.committed;
  return addRange(state.committed, state.open);
}

/**
 * 前回フラッシュ時点(sentRanges)と現在の確定レンジ(committed + open)を比較し、
 * サーバーへ送るべき差分レンジを求める。送信済みは再送しない。
 *
 * 単純化のため「現在の有効レンジ」をそのまま返す(サーバー側でマージ前提)。
 * 既送信レンジと完全に一致する場合は空配列を返してネットワークを節約する。
 */
export function pendingRanges(
  state: WatchedTrackerState,
  sentRanges: TimeRange[],
): TimeRange[] {
  const eff = effectiveRanges(state);
  if (rangesEqual(eff, sentRanges)) return [];
  return eff;
}

export function rangesEqual(a: TimeRange[], b: TimeRange[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (Math.abs(x.start - y.start) > 0.001 || Math.abs(x.end - y.end) > 0.001) {
      return false;
    }
  }
  return true;
}
