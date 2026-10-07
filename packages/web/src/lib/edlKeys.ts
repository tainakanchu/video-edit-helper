import { SKIP_SMALL, type ShortcutHelp } from './keyboard';

export const EDL_SHORTCUTS: ShortcutHelp[] = [
  { keys: 'Space / K', desc: '再生 / 一時停止' },
  { keys: 'J / L', desc: '再生速度を一段下げる / 上げる' },
  { keys: '← / →', desc: '前 / 次の区間' },
  { keys: 'Shift + ← / →', desc: '10 秒戻る / 進む' },
  { keys: ', / .', desc: '1 秒戻る / 進む' },
  { keys: '[ / ]', desc: '前 / 次の章' },
  { keys: 'Home / End', desc: '先頭 / 末尾' },
  { keys: 'Shift + ↑ / ↓', desc: 'プレビュー音量を上げる / 下げる' },
  { keys: 'N', desc: 'この時刻にコメント' },
  { keys: '?', desc: 'このヘルプを開閉' },
  { keys: 'Esc', desc: 'ヘルプを閉じる / 一覧へ戻る' },
];

export type EdlKeyAction =
  | { type: 'toggle' }
  | { type: 'rate'; dir: -1 | 1 }
  | { type: 'segment'; dir: -1 | 1 }
  | { type: 'skip'; delta: number }
  | { type: 'chapter'; dir: -1 | 1 }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'gain'; delta: number }
  | { type: 'comment' }
  | { type: 'help' }
  | { type: 'escape' };

/** meta / ctrl / alt 付きはブラウザに渡す */
export function edlKeyAction(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): EdlKeyAction | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  if (e.key === ' ' || e.key === 'k' || e.key === 'K') return { type: 'toggle' };
  if (e.key === 'j' || e.key === 'J') return { type: 'rate', dir: -1 };
  if (e.key === 'l' || e.key === 'L') return { type: 'rate', dir: 1 };
  if (e.key === 'ArrowLeft') {
    return e.shiftKey ? { type: 'skip', delta: -SKIP_SMALL } : { type: 'segment', dir: -1 };
  }
  if (e.key === 'ArrowRight') {
    return e.shiftKey ? { type: 'skip', delta: SKIP_SMALL } : { type: 'segment', dir: 1 };
  }
  if (e.key === ',') return { type: 'skip', delta: -1 };
  if (e.key === '.') return { type: 'skip', delta: 1 };
  if (e.key === 'Home') return { type: 'home' };
  if (e.key === 'End') return { type: 'end' };
  if (e.key === '[') return { type: 'chapter', dir: -1 };
  if (e.key === ']') return { type: 'chapter', dir: 1 };
  if (e.key === 'ArrowUp' && e.shiftKey) return { type: 'gain', delta: 0.25 };
  if (e.key === 'ArrowDown' && e.shiftKey) return { type: 'gain', delta: -0.25 };
  if (e.key === 'n' || e.key === 'N') return { type: 'comment' };
  if (e.key === '?') return { type: 'help' };
  if (e.key === 'Escape') return { type: 'escape' };
  return null;
}
