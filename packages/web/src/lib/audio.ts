/**
 * プレビュー音声(Web Audio GainNode によるブースト)用の純ロジック。
 *
 * DOM / Web Audio API に依存しない純関数のみを置き、PlayerContext / store /
 * AudioMeter から利用する。これらはユニットテスト対象(lib/audio.test.ts)。
 */

/** ゲインの下限・上限。HTML5 <video>.volume は最大 1.0 だが GainNode は増幅可能。 */
export const MIN_GAIN = 0;
export const MAX_GAIN = 5;

/** ↑ / ↓ キーでの増減幅 */
export const GAIN_STEP = 0.25;

/** ブースト中とみなす閾値(浮動小数の誤差を吸収) */
const BOOST_THRESHOLD = 1.001;

/** ゲインを [MIN_GAIN, MAX_GAIN] にクランプ。NaN は 1 にフォールバック。 */
export function clampGain(g: number): number {
  if (!Number.isFinite(g)) return 1;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, g));
}

/** 現在ゲインに delta を足してクランプした次のゲイン値。 */
export function nextGain(current: number, delta: number): number {
  return clampGain(clampGain(current) + delta);
}

/**
 * AnalyserNode.getByteTimeDomainData の出力(0..255, 無音=128)から RMS を 0..1 で算出。
 * 各サンプルを (v - 128) / 128 で -1..1 に正規化し、二乗平均平方根を取る。
 * 空入力は 0。
 */
export function rmsFromBytes(bytes: Uint8Array): number {
  const n = bytes.length;
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const x = (bytes[i]! - 128) / 128;
    sumSq += x * x;
  }
  const rms = Math.sqrt(sumSq / n);
  // 数値誤差で 1 を僅かに超える可能性をクランプ
  return rms > 1 ? 1 : rms;
}

/** ゲインをパーセント表示文字列に('1' → '100%', '2' → '200%')。 */
export function formatGainPercent(g: number): string {
  return `${Math.round(clampGain(g) * 100)}%`;
}

/** 原音(1.0)を超えて増幅している(ブースト中)か。 */
export function isBoosting(g: number): boolean {
  return g > BOOST_THRESHOLD;
}
