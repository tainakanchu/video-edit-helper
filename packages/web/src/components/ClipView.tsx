import { useEffect, useRef, useState } from 'react';
import { formatTime, type ID } from '@veh/shared';
import { isEditableTarget, rateDown, rateUp, SKIP_LARGE, SKIP_SMALL } from '../lib/keyboard';
import { nextSceneTime, prevSceneTime } from '../lib/sceneNav';
import { nextMarkerTime, prevMarkerTime } from '../lib/markerNav';
import { PlayerProvider, usePlayer } from './PlayerContext';
import { Player } from './Player';
import { ThumbnailStrip } from './ThumbnailStrip';
import { SpeechBar } from './SpeechBar';
import { NotesPanel } from './NotesPanel';
import { SelectionsPanel } from './SelectionsPanel';
import { TranscriptPanel } from './TranscriptPanel';
import { HelpOverlay } from './HelpOverlay';
import { ReviewToggle } from './ReviewToggle';
import { useAppStore, notesForClip } from '../store/useAppStore';
import { useRouter } from '../lib/useRouter';
import { api } from '../api/client';

type RightTab = 'notes' | 'selections' | 'transcript';

interface ClipViewProps {
  clipId: ID;
  initialSeekSec: number | null;
}

export function ClipView({ clipId, initialSeekSec }: ClipViewProps) {
  const clip = useAppStore((s) => s.project?.clips[clipId]);
  const { navigate } = useRouter();

  if (!clip) {
    return (
      <div className="loading">
        クリップが見つかりません。
        <button onClick={() => navigate({ name: 'home' })}>戻る</button>
      </div>
    );
  }

  return (
    <PlayerProvider key={clip.id} clip={clip} initialSeekSec={initialSeekSec}>
      <ClipViewInner />
    </PlayerProvider>
  );
}

function ClipViewInner() {
  const p = usePlayer();
  const clip = p.clip;
  const days = useAppStore((s) => s.project?.days ?? []);
  const day = days.find((d) => d.id === clip.dayId);
  const cycleReview = useAppStore((s) => s.cycleReview);
  const createSelection = useAppStore((s) => s.createSelection);
  const addNote = useAppStore((s) => s.addNote);
  const project = useAppStore((s) => s.project);
  const enqueue = useAppStore((s) => s.enqueue);
  const jobs = useAppStore((s) => s.jobs);
  const helpOpen = useAppStore((s) => s.helpOpen);
  const toggleHelp = useAppStore((s) => s.toggleHelp);
  const toast = useAppStore((s) => s.toast);
  const setHighlightSelection = useAppStore((s) => s.setHighlightSelection);
  const { navigate } = useRouter();

  const [tab, setTab] = useState<RightTab>('notes');
  /** ペンディング中のイン点(秒)。O 待ち */
  const [pendingIn, setPendingIn] = useState<number | null>(null);

  /** シーン転換点(クリップ通しタイムコード昇順)。null は未生成/未取得 */
  const [sceneTimes, setSceneTimes] = useState<number[] | null>(null);

  /** N キーで NotesPanel のクイック追加入力にフォーカスするためのトリガ */
  const focusNoteRef = useRef<(() => void) | null>(null);

  const backToDay = () =>
    navigate(day ? { name: 'day', dayId: day.id } : { name: 'home' });

  // 最新の pendingIn を参照するための ref(キーハンドラの依存を増やさない)
  const pendingInRef = useRef<number | null>(null);
  pendingInRef.current = pendingIn;

  // 最新の sceneTimes を参照するための ref(キーハンドラの依存を増やさない)
  const sceneTimesRef = useRef<number[] | null>(null);
  sceneTimesRef.current = sceneTimes;

  // 現在クリップの scenes ジョブが稼働中か
  const scenesActive = jobs.some(
    (j) =>
      j.type === 'scenes' &&
      j.clipId === clip.id &&
      (j.status === 'running' || j.status === 'queued'),
  );
  const prevScenesActiveRef = useRef(false);

  const fetchScenes = () => {
    let cancelled = false;
    api
      .getScenes(clip.id)
      .then((res) => {
        if (cancelled) return;
        setSceneTimes(res === null ? null : res.scenes.times);
      })
      .catch(() => {
        if (cancelled) return;
        setSceneTimes(null);
      });
    return () => {
      cancelled = true;
    };
  };

  // クリップ変更時に取得
  useEffect(() => {
    setSceneTimes(null);
    const cancel = fetchScenes();
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  // scenes ジョブが稼働中→停止に転じたら再取得
  useEffect(() => {
    const prev = prevScenesActiveRef.current;
    prevScenesActiveRef.current = scenesActive;
    if (prev && !scenesActive) fetchScenes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenesActive]);

  // マーカー(付箋)時刻の昇順リスト。↑ / ↓ のジャンプ先計算に使う
  const markerTimes = project ? notesForClip(project, clip.id).map((n) => n.timeSec) : [];
  const markerTimesRef = useRef<number[]>(markerTimes);
  markerTimesRef.current = markerTimes;

  /** M: 現在位置にラフなマーカー(空テキストの付箋)を即時に打つ */
  const addMarker = async () => {
    const at = p.virtualTimeSec;
    const note = await addNote(clip.id, at, '', []);
    if (note) toast(`マーカーを追加 ${formatTime(at)}`, 'info');
  };

  const markIn = () => {
    setPendingIn(p.virtualTimeSec);
  };

  const markOut = async () => {
    const inSec = pendingInRef.current;
    if (inSec === null) {
      toast('先に I でイン点を打ってください', 'info');
      return;
    }
    const outSec = p.virtualTimeSec;
    if (outSec <= inSec) {
      toast('アウト点はイン点より後にしてください', 'info');
      return;
    }
    setPendingIn(null);
    const sel = await createSelection(clip.id, { inSec, outSec, text: '', tags: [] });
    if (sel) {
      toast(`選定を作成 ${formatTime(inSec)}–${formatTime(outSec)}`, 'info');
      setTab('selections');
      setHighlightSelection(sel.id);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
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
        case ',':
          e.preventDefault();
          p.seekBy(-1);
          break;
        case '.':
          e.preventDefault();
          p.seekBy(1);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          p.seekBy(-(e.shiftKey ? SKIP_LARGE : SKIP_SMALL));
          break;
        case 'ArrowRight':
          e.preventDefault();
          p.seekBy(e.shiftKey ? SKIP_LARGE : SKIP_SMALL);
          break;
        case 'Home':
          e.preventDefault();
          p.seekTo(0);
          break;
        case 'End':
          e.preventDefault();
          p.seekTo(p.totalSec);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (e.shiftKey) {
            p.nudgeGain(0.25); // Shift+↑ = 音量アップ
          } else {
            const prev = prevMarkerTime(markerTimesRef.current, p.virtualTimeSec);
            if (prev !== null) p.seekTo(prev); // ↑ = 前のマーカーへ
          }
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (e.shiftKey) {
            p.nudgeGain(-0.25); // Shift+↓ = 音量ダウン
          } else {
            const next = nextMarkerTime(markerTimesRef.current, p.virtualTimeSec);
            if (next !== null) p.seekTo(next); // ↓ = 次のマーカーへ
          }
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          void addMarker(); // M = マーカーを打つ(DaVinci / Edius)
          break;
        case 'i':
        case 'I':
          e.preventDefault();
          markIn();
          break;
        case 'o':
        case 'O':
          e.preventDefault();
          void markOut();
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          setTab('notes');
          focusNoteRef.current?.();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          void cycleReview(clip.id);
          break;
        case '[': {
          const scenes = sceneTimesRef.current;
          if (scenes && scenes.length > 0) {
            e.preventDefault();
            p.seekTo(prevSceneTime(scenes, p.virtualTimeSec));
          }
          break;
        }
        case ']': {
          const scenes = sceneTimesRef.current;
          if (scenes && scenes.length > 0) {
            e.preventDefault();
            p.seekTo(nextSceneTime(scenes, p.virtualTimeSec));
          }
          break;
        }
        case '?':
          e.preventDefault();
          toggleHelp();
          break;
        case 'Escape':
          if (helpOpen) toggleHelp(false);
          else if (pendingInRef.current !== null) setPendingIn(null);
          else backToDay();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, clip.id, helpOpen, cycleReview, toggleHelp]);

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
        {scenesActive ? (
          <span className="scene-state muted" title="場面転換検出を実行中です">
            シーン解析中…
          </span>
        ) : sceneTimes && sceneTimes.length > 0 ? (
          <span className="scene-state muted" title="[ / ] で前後のシーンへジャンプできます">
            シーン {sceneTimes.length}
          </span>
        ) : (
          <button
            className="ghost"
            onClick={() => void enqueue('scenes', [clip.id])}
            title="映像の場面転換を検出してチャプターを付けます(CPU で時間がかかる重い処理です)"
          >
            シーン解析を実行
          </button>
        )}
        <ReviewToggle clipId={clip.id} status={clip.reviewStatus} />
        <button className="ghost" onClick={() => toggleHelp()} title="ショートカット (?)">
          ?
        </button>
      </div>

      <div className="stage">
        <div className="center">
          <Player pendingInSec={pendingIn} sceneTimes={sceneTimes} />
          <ThumbnailStrip pendingInSec={pendingIn} sceneTimes={sceneTimes} />
          <SpeechBar />
        </div>
        <div className="notes-col">
          <div className="rtabs">
            <button
              className={tab === 'notes' ? 'rtab active' : 'rtab'}
              onClick={() => setTab('notes')}
            >
              メモ
            </button>
            <button
              className={tab === 'selections' ? 'rtab active' : 'rtab'}
              onClick={() => setTab('selections')}
            >
              選定
            </button>
            <button
              className={tab === 'transcript' ? 'rtab active' : 'rtab'}
              onClick={() => setTab('transcript')}
            >
              文字起こし
            </button>
          </div>
          <div className="rtab-body">
            {tab === 'notes' && (
              <NotesPanel
                registerFocus={(fn: () => void) => (focusNoteRef.current = fn)}
                onPromoted={() => setTab('selections')}
              />
            )}
            {tab === 'selections' && <SelectionsPanel />}
            {tab === 'transcript' && <TranscriptPanel />}
          </div>
        </div>
      </div>

      {helpOpen && <HelpOverlay onClose={() => toggleHelp(false)} />}
    </div>
  );
}
