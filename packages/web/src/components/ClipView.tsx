import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { isEditableTarget, rateDown, rateUp, SKIP_LARGE, SKIP_SMALL } from '../lib/keyboard';
import { PlayerProvider, usePlayer } from './PlayerContext';
import { Player } from './Player';
import { ThumbnailStrip } from './ThumbnailStrip';
import { SpeechBar } from './SpeechBar';
import { NotesPanel } from './NotesPanel';
import { HelpOverlay } from './HelpOverlay';
import { ReviewToggle } from './ReviewToggle';

export function ClipView() {
  const clipId = useAppStore((s) => s.selectedClipId);
  const clip = useAppStore((s) => (clipId ? s.project?.clips[clipId] : undefined));

  if (!clip) {
    return (
      <div className="loading">
        クリップが見つかりません。<button onClick={() => useAppStore.getState().backToDay()}>戻る</button>
      </div>
    );
  }

  return (
    <PlayerProvider key={clip.id} clip={clip}>
      <ClipViewInner />
    </PlayerProvider>
  );
}

function ClipViewInner() {
  const p = usePlayer();
  const clip = p.clip;
  const days = useAppStore((s) => s.project?.days ?? []);
  const day = days.find((d) => d.id === clip.dayId);
  const backToDay = useAppStore((s) => s.backToDay);
  const cycleReview = useAppStore((s) => s.cycleReview);
  const helpOpen = useAppStore((s) => s.helpOpen);
  const toggleHelp = useAppStore((s) => s.toggleHelp);

  /** N キーで NotesPanel のクイック追加入力にフォーカスするためのトリガ */
  const focusNoteRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 入力欄フォーカス中はショートカット無効(Esc のみ各入力側で処理)
      if (isEditableTarget(e.target)) return;
      // 修飾キー(Ctrl/Meta/Alt)が絡む場合は OS / ブラウザに委ねる
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          p.togglePlay();
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          p.setRate(rateDown(p.rate));
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          p.setRate(rateUp(p.rate));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          p.seekBy(-(e.shiftKey ? SKIP_LARGE : SKIP_SMALL));
          break;
        case 'ArrowRight':
          e.preventDefault();
          p.seekBy(e.shiftKey ? SKIP_LARGE : SKIP_SMALL);
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          focusNoteRef.current?.();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          void cycleReview(clip.id);
          break;
        case '?':
          e.preventDefault();
          toggleHelp();
          break;
        case 'Escape':
          if (helpOpen) toggleHelp(false);
          else backToDay();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p, clip.id, helpOpen, cycleReview, toggleHelp, backToDay]);

  return (
    <div className="clipview">
      <div className="crumbs">
        <button className="ghost" onClick={backToDay} title="戻る (Esc)">
          ← 戻る
        </button>
        <span className="path">
          <b>Day {day?.index ?? '?'}</b>
          {' > '}
          <b>{clip.name}</b>
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <ReviewToggle clipId={clip.id} status={clip.reviewStatus} />
        <button className="ghost" onClick={() => toggleHelp()} title="ショートカット (?)">
          ?
        </button>
      </div>

      <div className="stage">
        <div className="center">
          <Player />
          <ThumbnailStrip />
          <SpeechBar />
        </div>
        <div className="notes-col">
          <NotesPanel registerFocus={(fn: () => void) => (focusNoteRef.current = fn)} />
        </div>
      </div>

      {helpOpen && <HelpOverlay onClose={() => toggleHelp(false)} />}
    </div>
  );
}
