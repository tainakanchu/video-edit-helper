/**
 * マーカー(付箋)間ジャンプの純ロジック(テスト対象・DOM 非依存)。
 *
 * シーン転換点(sceneNav)と違い、マーカーは「実在する点だけにジャンプ」したいので
 * 該当が無ければ null を返す(クリップ先頭や末尾へクランプしない)。
 * times は「クリップ通しタイムコード昇順」を前提とする。
 */

/** 浮動小数の現在時刻を考慮した「同じ点」とみなす許容差(秒) */
const MARKER_EPSILON = 0.05;

/** 現在時刻より前で最も近いマーカー時刻。無ければ null */
export function prevMarkerTime(times: number[], currentSec: number): number | null {
  let result: number | null = null;
  for (const t of times) {
    if (t < currentSec - MARKER_EPSILON) {
      result = t;
    } else {
      break;
    }
  }
  return result;
}

/** 現在時刻より後で最も近いマーカー時刻。無ければ null */
export function nextMarkerTime(times: number[], currentSec: number): number | null {
  for (const t of times) {
    if (t > currentSec + MARKER_EPSILON) {
      return t;
    }
  }
  return null;
}
