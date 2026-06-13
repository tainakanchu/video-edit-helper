/** whisper-cli -oj 出力の 1 セグメント */
interface WhisperSegment {
  offsets?: { from?: unknown; to?: unknown };
  text?: unknown;
}

/** parseWhisperJsonObject で返す型 */
export interface WhisperParsedItem {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * すでにパース済みの unknown オブジェクトから whisper 結果を取り出す純関数。
 * フィールド欠損・型不正に対してdefensiveに処理し、例外を投げない。
 */
export function parseWhisperJsonObject(obj: unknown): WhisperParsedItem[] {
  if (!obj || typeof obj !== 'object') return [];
  const root = obj as Record<string, unknown>;
  if (!Array.isArray(root['transcription'])) return [];

  const results: WhisperParsedItem[] = [];
  for (const item of root['transcription'] as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const seg = item as WhisperSegment;
    const offsets = seg.offsets;
    if (!offsets || typeof offsets !== 'object') continue;
    const fromMs = offsets.from;
    const toMs = offsets.to;
    if (typeof fromMs !== 'number' || typeof toMs !== 'number') continue;
    const rawText = seg.text;
    if (typeof rawText !== 'string') continue;
    const text = rawText.trim();
    if (text === '') continue;
    results.push({ startSec: fromMs / 1000, endSec: toMs / 1000, text });
  }
  return results;
}

/**
 * whisper-cli -oj が出力する JSON 文字列をパースして結果を返す純関数。
 * JSON パースに失敗した場合は [] を返す。
 */
export function parseWhisperJson(jsonText: string): WhisperParsedItem[] {
  let obj: unknown;
  try {
    obj = JSON.parse(jsonText) as unknown;
  } catch {
    return [];
  }
  return parseWhisperJsonObject(obj);
}
