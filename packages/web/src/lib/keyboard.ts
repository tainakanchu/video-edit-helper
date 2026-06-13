/** 再生速度の段階(J / L で循環) */
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 3] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export function rateDown(rate: number): PlaybackRate {
  const i = nearestRateIndex(rate);
  return PLAYBACK_RATES[Math.max(0, i - 1)]!;
}

export function rateUp(rate: number): PlaybackRate {
  const i = nearestRateIndex(rate);
  return PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, i + 1)]!;
}

function nearestRateIndex(rate: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < PLAYBACK_RATES.length; i++) {
    const d = Math.abs(PLAYBACK_RATES[i]! - rate);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}

/** スキップ秒数 */
export const SKIP_SMALL = 10;
export const SKIP_LARGE = 60;

export interface ShortcutHelp {
  keys: string;
  desc: string;
}

/** HelpOverlay 用のショートカット一覧(日本語) */
export const SHORTCUTS: ShortcutHelp[] = [
  { keys: 'Space / K', desc: '再生 / 一時停止' },
  { keys: 'J', desc: '再生速度を一段下げる' },
  { keys: 'L', desc: '再生速度を一段上げる' },
  { keys: '← / →', desc: '10 秒戻る / 進む' },
  { keys: 'Shift + ← / →', desc: '1 分戻る / 進む' },
  { keys: 'I', desc: '現在位置をイン点に(範囲選定)' },
  { keys: 'O', desc: 'アウト点を打って選定を作成' },
  { keys: 'N', desc: '現在位置に付箋を追加' },
  { keys: 'R', desc: 'レビュー状態を循環(未確認 → 確認中 → 確認済み)' },
  { keys: '[', desc: '前のシーンへジャンプ(シーン解析済みの場合)' },
  { keys: ']', desc: '次のシーンへジャンプ(シーン解析済みの場合)' },
  { keys: '?', desc: 'このヘルプを開閉' },
  { keys: 'Esc', desc: 'イン点解除 / オーバーレイを閉じる / 一覧へ戻る' },
];

/** トリアージビュー用のショートカット一覧 */
export const TRIAGE_SHORTCUTS: ShortcutHelp[] = [
  { keys: 'Y', desc: '昇格(デフォルト窓で選定を作成)' },
  { keys: 'X', desc: '破棄' },
  { keys: '→', desc: 'スキップ(後回し)' },
  { keys: 'Space / K', desc: '再生 / 一時停止' },
  { keys: 'Esc', desc: 'Day へ戻る' },
];

/** イベント発生元が入力欄(入力中)かどうか。input/textarea/contentEditable はショートカット無効 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** 入力テキストから `#タグ` を抽出して { text(タグ除去後), tags } に分解 */
export function parseTags(input: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  const tagRe = /#([^\s#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(input)) !== null) {
    const tag = m[1]!;
    if (!tags.includes(tag)) tags.push(tag);
  }
  const text = input.replace(tagRe, '').replace(/\s+/g, ' ').trim();
  return { text, tags };
}
