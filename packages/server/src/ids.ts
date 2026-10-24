/**
 * キャッシュのファイル名に使う ID の検証。
 *
 * clipId / fileId は sha1 の先頭 12 桁(scan/grouping.ts の shortHash)なので 16 進のみ。
 * API の :clipId はここで弾き、path.join に `..` や区切り文字が渡らないようにする。
 */
export const CLIP_ID_PATTERN = /^[a-f0-9]{1,64}$/;

export function isValidClipId(id: unknown): id is string {
  return typeof id === 'string' && CLIP_ID_PATTERN.test(id);
}

/** 1 つのパス要素として安全な文字だけか(区切り文字・`..`・空を含まない) */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * キャッシュのパスを組み立てる直前の多重防御。ルートで検証済みでも、
 * 呼び出し元が増えたときにトラバーサルにならないようにここでも確かめる。
 */
export function safeIdSegment(id: string): string {
  if (!SAFE_SEGMENT.test(id)) throw new Error(`invalid id for cache path: ${JSON.stringify(id)}`);
  return id;
}
