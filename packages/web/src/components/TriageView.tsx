import { useEffect, useRef, useState } from 'react';
import { type Clip, type ID, type Note } from '@veh/shared';
import { isEditableTarget, TRIAGE_SHORTCUTS } from '../lib/keyboard';
import {
  advanceProcessed,
  advanceSkip,
  currentNoteId,
  doneCount,
  isComplete,
  remainingCount,
  type TriageQueue,
} from '../lib/triage';
import { PlayerProvider, usePlayer } from './PlayerContext';
import { Player } from './Player';
import { ThumbnailStrip } from './ThumbnailStrip';
import { SpeechBar } from './SpeechBar';
import { useAppStore, notesForClip } from '../store/useAppStore';
import { useRouter } from '../lib/useRouter';

/**
 * トリアージ集中モード。
 *
 * Day 内の open 付箋を [clip.recordedAt, note.timeSec] 昇順で 1 件ずつ処理する。
 * - キューは「セッション状態」として一度だけ初期化し、project の更新では作り直さない
 *   (途中で project が変わっても進行を失わないため、getState() を初期化子で 1 回だけ読む)。
 */
export function TriageView({ dayId }: { dayId: string }) {
  const project = useAppStore((s) => s.project);
  const promoteNote = useAppStore((s) => s.promoteNote);
  const discardNote = useAppStore((s) => s.discardNote);
  const { navigate } = useRouter();

  // --- キューはセッション開始時に 1 回だけ構築(以後 project の変化で作り直さない) ---
  const [queue, setQueue] = useState<TriageQueue>(() => buildOrderedQueue(dayId));

  const day = project?.days.find((d) => d.id === dayId);

  if (!project || !day) {
    return (
      <div className="triage">
        <div className="empty">
          <p>Day が見つかりません</p>
          <button className="primary" onClick={() => navigate({ name: 'home' })}>
            ホームへ
          </button>
        </div>
      </div>
    );
  }

  const curId = currentNoteId(queue);
  const note = curId ? project.notes[curId] : undefined;
  const clip = note ? project.clips[note.clipId] : undefined;

  // --- アクション(キュー進行 + サーバー反映)。inner からも呼べるよう outer で定義 ---
  const onPromote = async () => {
    const id = currentNoteId(queue);
    if (!id) return;
    await promoteNote(id);
    setQueue((q) => advanceProcessed(q));
  };

  const onDiscard = async () => {
    const id = currentNoteId(queue);
    if (!id) return;
    await discardNote(id);
    setQueue((q) => advanceProcessed(q));
  };

  const onSkip = () => {
    setQueue((q) => advanceSkip(q));
  };

  const backToDay = () => navigate({ name: 'day', dayId });

  return (
    <div className="triage">
      <div className="triage-head">
        <button className="ghost" onClick={backToDay} title="Day へ戻る (Esc)">
          ← Day へ戻る
        </button>
        <span className="progress">
          残り {remainingCount(queue)} 件 / 処理済み {doneCount(queue)} 件
        </span>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="hint">
          {TRIAGE_SHORTCUTS.map((s) => `${s.keys} ${s.desc}`).join(' / ')}
        </span>
      </div>

      {isComplete(queue) || !note || !clip ? (
        <div className="empty">
          <p>すべての付箋を処理しました</p>
          <button className="primary" onClick={backToDay}>
            Day へ戻る
          </button>
        </div>
      ) : (
        <PlayerProvider
          key={clip.id + ':' + (curId ?? '')}
          clip={clip}
          initialSeekSec={note.timeSec}
        >
          <TriageInner
            note={note}
            clip={clip}
            onPromote={onPromote}
            onDiscard={onDiscard}
            onSkip={onSkip}
            onBack={backToDay}
          />
        </PlayerProvider>
      )}
    </div>
  );
}

/**
 * Day の open 付箋を [clip.recordedAt, note.timeSec] 昇順に並べてキューを作る。
 * buildTriageQueue は timeSec のみで再ソートしクリップをまたいで混ざるため、
 * ここでは順序を自前で確定し、TriageQueue を手組みする。
 */
function buildOrderedQueue(dayId: ID): TriageQueue {
  const project = useAppStore.getState().project;
  const day = project?.days.find((d) => d.id === dayId);
  if (!project || !day) return { order: [], index: 0, done: new Set() };

  const rows: Array<{ id: ID; recordedAt: string; timeSec: number }> = [];
  for (const clipId of day.clipIds) {
    const clip = project.clips[clipId];
    if (!clip) continue;
    for (const n of notesForClip(project, clipId)) {
      if (n.status !== 'open') continue;
      rows.push({ id: n.id, recordedAt: clip.recordedAt, timeSec: n.timeSec });
    }
  }
  rows.sort((a, b) => {
    if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
    return a.timeSec - b.timeSec;
  });

  return { order: rows.map((r) => r.id), index: 0, done: new Set() };
}

interface TriageInnerProps {
  note: Note;
  clip: Clip;
  onPromote: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onSkip: () => void;
  onBack: () => void;
}

function TriageInner({ note, clip, onPromote, onDiscard, onSkip, onBack }: TriageInnerProps) {
  const p = usePlayer();

  // 最新のコールバックを参照する ref(キーハンドラの依存を増やさず stale closure を防ぐ)
  const cbRef = useRef({ onPromote, onDiscard, onSkip, onBack });
  cbRef.current = { onPromote, onDiscard, onSkip, onBack };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'y':
        case 'Y':
          e.preventDefault();
          void cbRef.current.onPromote();
          break;
        case 'x':
        case 'X':
          e.preventDefault();
          void cbRef.current.onDiscard();
          break;
        case 'ArrowRight':
          e.preventDefault();
          cbRef.current.onSkip();
          break;
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          p.togglePlay();
          break;
        case 'Escape':
          e.preventDefault();
          cbRef.current.onBack();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  return (
    <div className="triage-body">
      <div className="center">
        <Player />
        <ThumbnailStrip />
        <SpeechBar />
      </div>

      <div className="triage-note">
        <div className="meta">
          <b>{clip.name}</b>
        </div>
        <p className="text">{note.text || '(メモなし)'}</p>
        {note.tags.length > 0 && (
          <div className="tags">
            {note.tags.map((t) => (
              <span key={t} className="tag">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="triage-actions">
          <button className="primary" onClick={() => void cbRef.current.onPromote()}>
            昇格 (Y)
          </button>
          <button className="ghost" onClick={() => void cbRef.current.onDiscard()}>
            破棄 (X)
          </button>
          <button className="ghost" onClick={() => cbRef.current.onSkip()}>
            スキップ (→)
          </button>
        </div>
      </div>
    </div>
  );
}
