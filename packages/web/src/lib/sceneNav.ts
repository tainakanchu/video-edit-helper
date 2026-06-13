/**
 * シーンチャプター(場面転換点)まわりの純ロジック(テスト対象)。
 * DOM 非依存。
 *
 * シーン転換点 times は「クリップ通しタイムコード昇順」を前提とする。
 * `[` で前の転換点へ、`]` で次の転換点へジャンプする際のジャンプ先を計算する。
 */

/** 浮動小数の timeupdate を考慮した「同じ転換点」とみなす許容差(秒) */
const SCENE_EPSILON = 0.05;

/**
 * 現在時刻より前にある最も近いシーン転換点を返す。
 *
 * - 先頭の転換点より前(または転換点が無い)なら 0(クリップ先頭)へ。
 * - 「現在ほぼ転換点上」の場合はその点ではなく、さらに 1 つ前へ戻る
 *   (連打で順に遡れるようにするため)。
 */
export function prevSceneTime(times: number[], currentSec: number): number {
  let result = 0;
  for (const t of times) {
    if (t < currentSec - SCENE_EPSILON) {
      result = t;
    } else {
      break;
    }
  }
  return result;
}

/**
 * 現在時刻より後にある最も近いシーン転換点を返す。
 *
 * - 最後の転換点より後(または転換点が無い)場合は「最後の転換点」へクランプする。
 *   転換点が空なら現在時刻を維持する。
 * - 「現在ほぼ転換点上」の場合はその点ではなく、さらに 1 つ先へ進む。
 */
export function nextSceneTime(times: number[], currentSec: number): number {
  for (const t of times) {
    if (t > currentSec + SCENE_EPSILON) {
      return t;
    }
  }
  // 後ろに転換点が無い: 最後の転換点へクランプ(転換点が空なら現在時刻を維持)。
  const last = times[times.length - 1];
  return last !== undefined ? last : currentSec;
}
