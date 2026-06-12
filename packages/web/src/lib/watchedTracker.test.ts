import { describe, expect, it } from 'vitest';
import {
  commitOpen,
  createWatchedState,
  effectiveRanges,
  pendingRanges,
  rangesEqual,
  seekThreshold,
  track,
  type WatchedTrackerState,
} from './watchedTracker';

/** イベント列を順に track へ流し込むヘルパ */
function run(
  events: Array<{ t: number; playing?: boolean; rate?: number }>,
  initial: WatchedTrackerState = createWatchedState(),
): WatchedTrackerState {
  let s = initial;
  for (const e of events) {
    s = track(s, e.t, e.playing ?? true, e.rate ?? 1);
  }
  return s;
}

describe('seekThreshold', () => {
  it('1x は 2 秒', () => {
    expect(seekThreshold(1)).toBe(2);
  });
  it('2x は 4 秒', () => {
    expect(seekThreshold(2)).toBe(4);
  });
  it('0.5x でも最小 2 秒', () => {
    expect(seekThreshold(0.5)).toBe(2);
  });
  it('不正値は 1x 扱い', () => {
    expect(seekThreshold(0)).toBe(2);
    expect(seekThreshold(Number.NaN)).toBe(2);
  });
});

describe('track: 連続再生', () => {
  it('timeupdate(約 4Hz)の連続前進で 1 本のレンジに伸びる', () => {
    const s = run([
      { t: 0 },
      { t: 0.25 },
      { t: 0.5 },
      { t: 0.75 },
      { t: 1.0 },
    ]);
    expect(effectiveRanges(s)).toEqual([{ start: 0, end: 1.0 }]);
  });

  it('閾値ちょうどの前進は連続扱い(2x で 4 秒)', () => {
    const s = run([
      { t: 10, rate: 2 },
      { t: 14, rate: 2 }, // +4 == threshold
    ]);
    expect(effectiveRanges(s)).toEqual([{ start: 10, end: 14 }]);
  });
});

describe('track: シーク', () => {
  it('閾値を超える前方ジャンプは現在レンジを閉じ新レンジを開始', () => {
    const s = run([
      { t: 0 },
      { t: 1 },
      { t: 2 }, // ここまで [0,2]
      { t: 30 }, // +28 はシーク → 新レンジ
      { t: 31 },
    ]);
    expect(effectiveRanges(s)).toEqual([
      { start: 0, end: 2 },
      { start: 30, end: 31 },
    ]);
  });

  it('後退(巻き戻し)も現在レンジを閉じる', () => {
    const s = run([
      { t: 10 },
      { t: 11 },
      { t: 5 }, // 後退
      { t: 6 },
    ]);
    expect(effectiveRanges(s)).toEqual([
      { start: 5, end: 6 },
      { start: 10, end: 11 },
    ]);
  });
});

describe('track: 一時停止', () => {
  it('一時停止で現在レンジを確定し、再開で新レンジ', () => {
    let s = run([{ t: 0 }, { t: 1 }, { t: 2 }]);
    s = track(s, 2, false, 1); // pause
    expect(s.open).toBeNull();
    s = track(s, 2, true, 1); // resume(同じ位置)
    s = track(s, 3, true, 1);
    expect(effectiveRanges(s)).toEqual([{ start: 0, end: 3 }]);
  });

  it('近接レンジは normalize でマージされる', () => {
    // 0..2 で停止し、2 から再開 → epsilon 内で 1 本に
    let s = run([{ t: 0 }, { t: 2 }]);
    s = track(s, 2, false, 1);
    s = track(s, 2, true, 1);
    s = track(s, 4, true, 1);
    expect(effectiveRanges(s)).toEqual([{ start: 0, end: 4 }]);
  });
});

describe('commitOpen / effectiveRanges', () => {
  it('commitOpen でオープン中レンジが committed に入る', () => {
    let s = run([{ t: 0 }, { t: 1 }]);
    expect(s.open).not.toBeNull();
    s = commitOpen(s);
    expect(s.open).toBeNull();
    expect(s.committed).toEqual([{ start: 0, end: 1 }]);
  });

  it('effectiveRanges は committed + open を合算', () => {
    const s = run([{ t: 0 }, { t: 1 }, { t: 30 }, { t: 31 }]);
    expect(effectiveRanges(s)).toEqual([
      { start: 0, end: 1 },
      { start: 30, end: 31 },
    ]);
  });
});

describe('pendingRanges', () => {
  it('未送信の差分があれば現在の有効レンジを返す', () => {
    const s = run([{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }, { t: 4 }, { t: 5 }]);
    expect(pendingRanges(s, [])).toEqual([{ start: 0, end: 5 }]);
  });

  it('送信済みと一致すれば空配列(再送しない)', () => {
    const s = run([{ t: 0 }, { t: 1 }, { t: 2 }, { t: 3 }, { t: 4 }, { t: 5 }]);
    const sent = effectiveRanges(s);
    expect(pendingRanges(s, sent)).toEqual([]);
  });
});

describe('createWatchedState', () => {
  it('初期レンジを正規化して保持する', () => {
    const s = createWatchedState([
      { start: 5, end: 10 },
      { start: 0, end: 3 },
      { start: 9, end: 12 }, // 10 と重なる
    ]);
    expect(s.committed).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 12 },
    ]);
  });
});

describe('rangesEqual', () => {
  it('微小誤差を許容して比較', () => {
    expect(
      rangesEqual([{ start: 0, end: 1 }], [{ start: 0.0005, end: 1.0005 }]),
    ).toBe(true);
    expect(rangesEqual([{ start: 0, end: 1 }], [{ start: 0, end: 2 }])).toBe(false);
  });
});
