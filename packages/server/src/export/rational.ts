/** タイムベース(分子/分母)を fps から決定する */
export function pickTimebase(fps: number | null): { numer: number; denom: number } {
  if (fps === null) {
    // null の場合は 30fps 整数として扱う
    return { numer: 1, denom: 30 };
  }
  if (Math.abs(fps - 29.97) < 0.01) return { numer: 1001, denom: 30000 };
  if (Math.abs(fps - 59.94) < 0.01) return { numer: 1001, denom: 60000 };
  if (Math.abs(fps - 23.976) < 0.01) return { numer: 1001, denom: 24000 };
  // 整数 fps
  return { numer: 1, denom: Math.round(fps) };
}

/** フォーマット要素の frameDuration 文字列 e.g. "1001/30000s" for 29.97, "1/30s" for 30 */
export function frameDurationString(fps: number | null): string {
  const { numer, denom } = pickTimebase(fps);
  if (numer === 1) return `1/${denom}s`;
  return `${numer}/${denom}s`;
}

/** 秒 → FCPXML 有理数時間文字列 */
export function rationalTime(sec: number, fps: number | null): string {
  if (sec === 0) return '0s';
  const { numer, denom } = pickTimebase(fps);
  // frameDuration = numer/denom 秒
  const frameDuration = numer / denom;
  const frames = Math.round(sec / frameDuration);
  if (numer === 1) {
    // 整数 fps: ${frames}/${denom}s
    return `${frames}/${denom}s`;
  } else {
    // ドロップフレーム: ${frames * numer}/${denom}s
    return `${frames * numer}/${denom}s`;
  }
}
