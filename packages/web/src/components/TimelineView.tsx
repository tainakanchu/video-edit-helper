/**
 * EDL タイムライン。時刻の基準は requestAnimationFrame のマスタークロックで、
 * 映像の currentTime には従わない。区間が再生できなくても尺は進む。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  findSegmentIndex,
  formatTime,
  isSpeechStyle,
  stepChapter,
  stepSegment,
  type EdlComment,
  type EdlMusicPlan,
  type EdlSegmentPlan,
  type EdlSubtitle,
  type EdlTimeline,
  type EdlXPost,
  type PathRewrite,
} from '@veh/shared';
import { api, ApiError } from '../api/client';
import { nextGain } from '../lib/audio';
import { clockTime, type EdlClock } from '../lib/edlClock';
import { EDL_SHORTCUTS, edlKeyAction } from '../lib/edlKeys';
import { chapterIndexAt, fitPxPerSec, zoomAround } from '../lib/edlLayout';
import { isEditableTarget, PLAYBACK_RATES, rateDown, rateUp } from '../lib/keyboard';
import { useRouter } from '../lib/useRouter';
import { useAppStore } from '../store/useAppStore';
import { EdlStage, type EdlStageHandle } from './EdlStage';
import { EdlTracks } from './EdlTracks';
import { HelpOverlay } from './HelpOverlay';

interface TimelineViewProps {
  edlId: string | null;
  initialSeekSec: number | null;
}

interface Overlay {
  segIndex: number;
  chapterIndex: number;
  subs: EdlSubtitle[];
  posts: EdlXPost[];
  music: EdlMusicPlan[];
}

const EMPTY_OVERLAY: Overlay = {
  segIndex: -1,
  chapterIndex: -1,
  subs: [],
  posts: [],
  music: [],
};

export function TimelineView({ edlId, initialSeekSec }: TimelineViewProps) {
  const { navigate } = useRouter();
  const project = useAppStore((s) => s.project);
  const refreshProject = useAppStore((s) => s.refreshProject);
  const toast = useAppStore((s) => s.toast);
  const helpOpen = useAppStore((s) => s.helpOpen);
  const toggleHelp = useAppStore((s) => s.toggleHelp);
  const audioGain = useAppStore((s) => s.audioGain);
  const audioMuted = useAppStore((s) => s.audioMuted);
  const toggleMute = useAppStore((s) => s.toggleMute);
  const audioSinkId = useAppStore((s) => s.audioSinkId);

  const sources = project?.settings.edlSources ?? [];
  const source = sources.find((s) => s.id === edlId) ?? null;

  const [timeline, setTimeline] = useState<EdlTimeline | null>(null);
  const [comments, setComments] = useState<EdlComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [px, setPx] = useState(8);
  const [overlay, setOverlay] = useState<Overlay>(EMPTY_OVERLAY);
  const [pathInput, setPathInput] = useState('');
  const [cacheAdd, setCacheAdd] = useState('');
  const [cacheInput, setCacheInput] = useState('');
  const [commentText, setCommentText] = useState('');
  const [rewrites, setRewrites] = useState<PathRewrite[]>([]);
  const [distro, setDistro] = useState('');

  const clockRef = useRef<EdlClock>({ originSec: 0, playing: false, anchorMs: 0, rate: 1 });
  const timeRef = useRef(0);
  const pxRef = useRef(px);
  pxRef.current = px;
  const timelineRef = useRef<EdlTimeline | null>(timeline);
  timelineRef.current = timeline;
  const stageRef = useRef<EdlStageHandle>(null);
  const timeLabelRef = useRef<HTMLSpanElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const autoScrollingRef = useRef(false);
  const lastUserScroll = useRef(0);
  const fittedFor = useRef<string | null>(null);
  const uiKeyRef = useRef('');
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;
  const commentRef = useRef<HTMLInputElement>(null);
  const chipRowRef = useRef<HTMLDivElement>(null);
  const activeChipRef = useRef<HTMLButtonElement>(null);
  const edlIdRef = useRef(edlId);
  edlIdRef.current = edlId;

  const paint = useCallback((t: number) => {
    if (timeLabelRef.current) timeLabelRef.current.textContent = formatTime(t);
    const head = playheadRef.current;
    if (head) head.style.transform = `translateX(${t * pxRef.current}px)`;
  }, []);

  const publish = useCallback((t: number) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const segIndex = findSegmentIndex(tl.segments, t);
    const chapterIndex = chapterIndexAt(tl.chapters, t);
    const subKey = rangeKey(tl.subtitles, t, 0);
    const xKey = rangeKey(tl.xposts, t, 0);
    const musicKey = musicWindowKey(tl.music, t);
    const key = `${segIndex}|${chapterIndex}|${subKey}|${xKey}|${musicKey}`;
    if (key === uiKeyRef.current) return;
    uiKeyRef.current = key;
    setOverlay({
      segIndex,
      chapterIndex,
      subs: tl.subtitles.filter((s) => t >= s.start && t < s.end),
      posts: tl.xposts.filter((s) => t >= s.start && t < s.end),
      music: tl.music.filter((m) => !!m.url && t >= m.start - 3 && t < m.end),
    });
  }, []);

  const reveal = useCallback((t: number) => {
    const el = scrollerRef.current;
    const tl = timelineRef.current;
    if (!el || !tl) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const x = t * pxRef.current - el.scrollLeft;
    if (x >= 0 && x <= w) return;
    autoScrollingRef.current = true;
    const max = Math.max(0, tl.durationSec * pxRef.current - w);
    el.scrollLeft = Math.min(max, Math.max(0, t * pxRef.current - w / 2));
    queueMicrotask(() => {
      autoScrollingRef.current = false;
    });
  }, []);

  const seek = useCallback(
    (t: number, writeUrl = true) => {
      const tl = timelineRef.current;
      const next = clampTime(t, tl?.durationSec ?? 0);
      const clock = clockRef.current;
      clock.originSec = next;
      clock.anchorMs = performance.now();
      timeRef.current = next;
      paint(next);
      stageRef.current?.sync(next, clock.playing, true);
      publish(next);
      reveal(next);
      const id = edlIdRef.current;
      if (writeUrl && id) {
        navigate(
          { name: 'edl', edlId: id, t: Math.round(next * 1000) / 1000 },
          { replace: true },
        );
      }
    },
    [navigate, paint, publish, reveal],
  );

  const seekRef = useRef(seek);
  seekRef.current = seek;

  useEffect(() => {
    if (edlId) return;
    const list = project?.settings.edlSources ?? [];
    const active = project?.settings.activeEdlId ?? null;
    const id = active && list.some((s) => s.id === active) ? active : list[0]?.id;
    if (!id) return;
    navigate({ name: 'edl', edlId: id, t: initialSeekSec }, { replace: true });
  }, [edlId, project, navigate, initialSeekSec]);

  useEffect(() => {
    if (!edlId) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    Promise.all([api.getEdlTimeline(edlId), api.getEdlComments(edlId)])
      .then(([tl, cm]) => {
        if (cancel) return;
        uiKeyRef.current = '';
        setTimeline(tl.timeline);
        setComments(cm.comments);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancel) return;
        setTimeline(null);
        setComments([]);
        setError(errText(e));
        setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [edlId, reloadKey]);

  useEffect(() => {
    setCacheInput(source?.cacheDir ?? '');
  }, [source?.id, source?.cacheDir]);

  useEffect(() => {
    setRewrites((project?.settings.pathRewrites ?? []).map((r) => ({ ...r })));
    setDistro(project?.settings.wslDistro ?? '');
  }, [project?.settings.pathRewrites, project?.settings.wslDistro]);

  useLayoutEffect(() => {
    if (!timeline) return;
    if (initialSeekSec === null || !Number.isFinite(initialSeekSec)) return;
    if (Math.abs(timeRef.current - initialSeekSec) < 0.05) return;
    seekRef.current(initialSeekSec, false);
  }, [timeline, initialSeekSec]);

  useLayoutEffect(() => {
    if (!timeline) return;
    uiKeyRef.current = '';
    publish(timeRef.current);
  }, [timeline, publish]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!timeline || !el) return;
    const fitOnce = () => {
      if (fittedFor.current === timeline.sourceId) return;
      const w = el.clientWidth;
      if (w <= 0) return;
      fittedFor.current = timeline.sourceId;
      const fit = fitPxPerSec(timeline.durationSec, w);
      pxRef.current = fit;
      setPx(fit);
      el.scrollLeft = 0;
    };
    fitOnce();
    const ro = new ResizeObserver(fitOnce);
    ro.observe(el);
    return () => ro.disconnect();
  }, [timeline]);

  useLayoutEffect(() => {
    paint(timeRef.current);
  });

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      const tl = timelineRef.current;
      const clock = clockRef.current;
      if (tl) {
        let t = clockTime(clock, now, tl.durationSec);
        if (clock.playing && tl.durationSec > 0 && t >= tl.durationSec - 1e-4) {
          clock.playing = false;
          clock.originSec = tl.durationSec;
          clock.anchorMs = now;
          t = tl.durationSec;
          setPlaying(false);
        }
        timeRef.current = t;
        paint(t);
        stageRef.current?.sync(t, clock.playing, false);
        publish(t);
        if (clock.playing && now - lastUserScroll.current >= 2000) {
          const el = scrollerRef.current;
          if (el && el.clientWidth > 0) {
            const x = t * pxRef.current - el.scrollLeft;
            const w = el.clientWidth;
            if (x < 80 || x > w - 80) {
              const max = Math.max(0, tl.durationSec * pxRef.current - w);
              const target = Math.min(max, Math.max(0, t * pxRef.current - w / 2));
              if (Math.abs(el.scrollLeft - target) > 1) {
                autoScrollingRef.current = true;
                el.scrollLeft = target;
                queueMicrotask(() => {
                  autoScrollingRef.current = false;
                });
              }
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paint, publish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const action = edlKeyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action.type === 'escape') {
        if (helpOpenRef.current) toggleHelp(false);
        else navigate({ name: 'home' });
        return;
      }
      if (action.type === 'help') {
        toggleHelp();
        return;
      }
      const tl = timelineRef.current;
      if (!tl) return;
      const clock = clockRef.current;
      const nowT = () => clockTime(clock, performance.now(), tl.durationSec);
      if (action.type === 'toggle') {
        let t = nowT();
        if (!clock.playing && t >= tl.durationSec - 0.05) t = 0;
        clock.originSec = t;
        clock.anchorMs = performance.now();
        clock.playing = !clock.playing;
        timeRef.current = t;
        setPlaying(clock.playing);
        paint(t);
        stageRef.current?.sync(t, clock.playing, true);
        return;
      }
      if (action.type === 'rate') {
        const t = nowT();
        const next = action.dir < 0 ? rateDown(clock.rate) : rateUp(clock.rate);
        clock.originSec = t;
        clock.anchorMs = performance.now();
        clock.rate = next;
        timeRef.current = t;
        setRate(next);
        paint(t);
        stageRef.current?.sync(t, clock.playing, true);
        return;
      }
      if (action.type === 'segment') {
        seekRef.current(stepSegment(tl.segments, timeRef.current, action.dir));
        return;
      }
      if (action.type === 'skip') {
        seekRef.current(timeRef.current + action.delta);
        return;
      }
      if (action.type === 'chapter') {
        seekRef.current(stepChapter(tl.chapters, timeRef.current, action.dir));
        return;
      }
      if (action.type === 'home') {
        seekRef.current(0);
        return;
      }
      if (action.type === 'end') {
        seekRef.current(tl.durationSec);
        return;
      }
      if (action.type === 'gain') {
        const g = useAppStore.getState().audioGain;
        useAppStore.getState().setAudioGain(nextGain(g, action.delta));
        return;
      }
      if (action.type === 'comment') {
        const i = findSegmentIndex(tl.segments, timeRef.current);
        if (i < 0) {
          toast('区間の上でコメントしてください');
          return;
        }
        commentRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, paint, toast, toggleHelp]);

  useEffect(() => {
    const row = chipRowRef.current;
    const chip = activeChipRef.current;
    if (!row || !chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - 8);
    else if (right > row.scrollLeft + row.clientWidth) {
      row.scrollLeft = right - row.clientWidth + 8;
    }
  }, [overlay.chapterIndex, timeline?.sourceId]);

  const speechRanges = useMemo(
    () =>
      (timeline?.subtitles ?? [])
        .filter((s) => isSpeechStyle(s.style))
        .map((s) => ({ start: s.start, end: s.end })),
    [timeline],
  );

  const segment: EdlSegmentPlan | null =
    timeline && overlay.segIndex >= 0 ? (timeline.segments[overlay.segIndex] ?? null) : null;
  const nextSeg =
    timeline && overlay.segIndex >= 0 ? timeline.segments[overlay.segIndex + 1] : undefined;
  const preload =
    nextSeg && nextSeg.playback.kind === 'video'
      ? { id: nextSeg.id, video: nextSeg.playback }
      : null;
  const chapter =
    timeline && overlay.chapterIndex >= 0 ? timeline.chapters[overlay.chapterIndex] : undefined;

  const onZoom = useCallback((factor: number, cursorX: number, scrollLeft: number, widthPx: number) => {
    const tl = timelineRef.current;
    if (!tl) return;
    const next = zoomAround(pxRef.current, factor, cursorX, scrollLeft, tl.durationSec, widthPx);
    pxRef.current = next.pxPerSec;
    setPx(next.pxPerSec);
    if (scrollerRef.current) scrollerRef.current.scrollLeft = next.scrollLeft;
  }, []);

  const onUserScroll = useCallback(() => {
    lastUserScroll.current = performance.now();
  }, []);

  const fitAll = () => {
    const el = scrollerRef.current;
    const tl = timelineRef.current;
    if (!el || !tl) return;
    const w = el.clientWidth;
    if (w <= 0) return;
    const fit = fitPxPerSec(tl.durationSec, w);
    pxRef.current = fit;
    setPx(fit);
    el.scrollLeft = 0;
  };

  const setPlaybackRate = (next: number) => {
    const tl = timelineRef.current;
    const clock = clockRef.current;
    const t = tl ? clockTime(clock, performance.now(), tl.durationSec) : timeRef.current;
    clock.originSec = t;
    clock.anchorMs = performance.now();
    clock.rate = next;
    timeRef.current = t;
    setRate(next);
    paint(t);
    stageRef.current?.sync(t, clock.playing, true);
  };

  const toggle = () => {
    const tl = timelineRef.current;
    if (!tl) return;
    const clock = clockRef.current;
    let t = clockTime(clock, performance.now(), tl.durationSec);
    if (!clock.playing && t >= tl.durationSec - 0.05) t = 0;
    clock.originSec = t;
    clock.anchorMs = performance.now();
    clock.playing = !clock.playing;
    timeRef.current = t;
    setPlaying(clock.playing);
    paint(t);
    stageRef.current?.sync(t, clock.playing, true);
  };

  const addEdl = async () => {
    const path = pathInput.trim();
    if (!path) {
      toast('EDL のパスを入力してください');
      return;
    }
    try {
      const res = await api.addEdl({
        path,
        cacheDir: cacheAdd.trim() || undefined,
      });
      await refreshProject();
      setPathInput('');
      setCacheAdd('');
      if (res.activeEdlId) navigate({ name: 'edl', edlId: res.activeEdlId, t: null });
    } catch (e) {
      toast(errText(e));
    }
  };

  const pickEdl = async (id: string) => {
    if (id === edlId) return;
    try {
      await api.activateEdl({ id });
      await refreshProject();
      navigate({ name: 'edl', edlId: id, t: null });
    } catch (e) {
      toast(errText(e));
    }
  };

  const removeCurrent = async () => {
    if (!edlId) return;
    if (!window.confirm('一覧から外します。EDL ファイル自体は残ります。')) return;
    try {
      const res = await api.removeEdl(edlId);
      await refreshProject();
      navigate({ name: 'edl', edlId: res.activeEdlId, t: null }, { replace: true });
    } catch (e) {
      toast(errText(e));
    }
  };

  const saveCache = async () => {
    if (!edlId) return;
    try {
      await api.updateEdl(edlId, { cacheDir: cacheInput.trim() });
      await refreshProject();
      setReloadKey((n) => n + 1);
      toast('中間フォルダを保存しました', 'info');
    } catch (e) {
      toast(errText(e));
    }
  };

  const saveRewrites = async () => {
    const pathRewrites = rewrites
      .map((r) => ({ from: r.from.trim(), to: r.to.trim() }))
      .filter((r) => r.from && r.to);
    try {
      await api.updatePathRewrites({ pathRewrites, wslDistro: distro.trim() });
      await refreshProject();
      setReloadKey((n) => n + 1);
      toast('パス置換を保存しました', 'info');
    } catch (e) {
      toast(errText(e));
    }
  };

  const submitComment = async () => {
    const tl = timelineRef.current;
    if (!edlId || !tl) return;
    const text = commentText.trim();
    if (!text) {
      toast('コメントを入力してください');
      return;
    }
    const i = findSegmentIndex(tl.segments, timeRef.current);
    const seg = i >= 0 ? tl.segments[i] : undefined;
    if (!seg) {
      toast('区間の上でコメントしてください');
      return;
    }
    try {
      const res = await api.addEdlComment(edlId, {
        segmentId: seg.id,
        timeSec: timeRef.current,
        text,
      });
      setComments((list) => [...list, res.comment].sort((a, b) => a.timeSec - b.timeSec));
      setCommentText('');
    } catch (e) {
      toast(errText(e));
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!edlId) return;
    if (!window.confirm('このコメントを削除しますか？')) return;
    try {
      await api.deleteEdlComment(edlId, commentId);
      setComments((list) => list.filter((c) => c.id !== commentId));
    } catch (e) {
      toast(errText(e));
    }
  };

  if (!edlId && sources.length > 0) {
    return <div className="loading">…</div>;
  }

  if (!edlId) {
    return (
      <div className="edl-view">
        <div className="edl-empty">
          <h1>EDL タイムライン</h1>
          <p>
            完成形の EDL（JSON）を読み込むと、書き出さずに並びを再生できます。パスと、あれば中間ファイルのフォルダを指定してください。
          </p>
          <AddForm
            pathInput={pathInput}
            cacheAdd={cacheAdd}
            onPath={setPathInput}
            onCache={setCacheAdd}
            onAdd={() => void addEdl()}
          />
        </div>
      </div>
    );
  }

  const segComments = segment
    ? comments.filter((c) => c.segmentId === segment.id).sort((a, b) => a.timeSec - b.timeSec)
    : [];
  const shownGain = Math.round(Math.min(1, audioGain) * 100);

  return (
    <div className="edl-view">
      <div className="edl-toolbar">
        <select
          aria-label="EDL"
          value={edlId}
          onChange={(e) => void pickEdl(e.target.value)}
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label || s.path}
            </option>
          ))}
        </select>
        <button className="ghost" onClick={() => void removeCurrent()} title="一覧から外す。ファイルは残ります">
          外す
        </button>
        <strong className="edl-title">{timeline?.title || source?.label || 'EDL'}</strong>
        <span className="edl-time">
          <span ref={timeLabelRef} />
          {timeline ? ` / ${formatTime(timeline.durationSec)}` : ''}
        </span>
        <span className="edl-where">{chapter?.title || (timeline ? '章の外' : '')}</span>
        <span className="edl-where">{segment ? segment.label : timeline ? '区間の外' : ''}</span>
        <button onClick={toggle} disabled={!timeline}>
          {playing ? '一時停止' : '再生'}
        </button>
        <span className="edl-rates">
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              className={r === rate ? 'active' : ''}
              onClick={() => setPlaybackRate(r)}
            >
              {r}x
            </button>
          ))}
        </span>
        <button className="ghost" onClick={fitAll} title="全体を表示">
          全体
        </button>
        <button className="ghost" onClick={() => onZoom(1 / 1.25, (scrollerRef.current?.clientWidth ?? 0) / 2, scrollerRef.current?.scrollLeft ?? 0, scrollerRef.current?.clientWidth ?? 1)} title="縮小">
          −
        </button>
        <button className="ghost" onClick={() => onZoom(1.25, (scrollerRef.current?.clientWidth ?? 0) / 2, scrollerRef.current?.scrollLeft ?? 0, scrollerRef.current?.clientWidth ?? 1)} title="拡大">
          +
        </button>
        <button className="ghost" onClick={toggleMute} title={audioMuted ? 'ミュート解除' : 'ミュート'}>
          {audioMuted ? 'ミュート中' : `音量 ${shownGain}%`}
        </button>
        <button className="ghost" onClick={() => toggleHelp()} title="ショートカット (?)">
          ?
        </button>
        {loading && timeline && <span className="muted">更新中…</span>}
      </div>

      {error && (
        <div className="edl-error">
          {error}
          <button className="ghost" onClick={() => setReloadKey((n) => n + 1)}>
            再読み込み
          </button>
        </div>
      )}

      {timeline && (
        <div className="edl-chapters" ref={chipRowRef}>
          {timeline.chapters.map((c, i) => (
            <button
              key={`${c.start}-${i}`}
              ref={i === overlay.chapterIndex ? activeChipRef : undefined}
              className={i === overlay.chapterIndex ? 'edl-chip active' : 'edl-chip'}
              onClick={() => seek(c.start)}
            >
              {c.title}
            </button>
          ))}
        </div>
      )}

      <div className="edl-body">
        <div className="edl-center">
          {timeline ? (
            <>
              <div className="edl-stage-wrap">
                <EdlStage
                  ref={stageRef}
                  segment={segment}
                  preload={preload}
                  subtitles={overlay.subs}
                  xposts={overlay.posts}
                  music={overlay.music}
                  speechRanges={speechRanges}
                  rate={rate}
                  audioGain={audioGain}
                  audioMuted={audioMuted}
                  audioSinkId={audioSinkId}
                />
              </div>
              <EdlTracks
                timeline={timeline}
                comments={comments}
                pxPerSec={px}
                currentId={segment?.id ?? null}
                timeRef={timeRef}
                playheadRef={playheadRef}
                scrollerRef={scrollerRef}
                autoScrollingRef={autoScrollingRef}
                onUserScroll={onUserScroll}
                onSeek={seek}
                onZoom={onZoom}
              />
            </>
          ) : (
            <div className="loading">{loading ? '読み込み中…' : 'EDL を表示できません'}</div>
          )}
        </div>

        <aside className="edl-side">
          {timeline && (
            <>
              <div className="edl-side-title">{timeline.title}</div>
              <div className="muted">
                {formatTime(timeline.durationSec)} · {timeline.fps} fps · {timeline.segments.length} 区間 · {timeline.resolvedOn}
              </div>
              <div className="muted edl-cache-line">
                {timeline.cache.resolved
                  ? `中間: ${timeline.cache.resolved}`
                  : timeline.cache.configured
                    ? '中間フォルダを解決できませんでした'
                    : '中間フォルダは未設定です'}
              </div>
            </>
          )}

          <label className="edl-label">
            中間ファイルのフォルダ
            <input
              value={cacheInput}
              onChange={(e) => setCacheInput(e.target.value)}
              placeholder="区間 mp4 のディレクトリ"
              spellCheck={false}
            />
          </label>
          <button onClick={() => void saveCache()}>中間フォルダを保存</button>

          {segment ? (
            <div className="edl-seginfo">
              <div className="edl-side-title">{segment.label}</div>
              <div className="muted">
                {segment.type} · {formatTime(segment.start)}–{formatTime(segment.start + segment.dur)}
              </div>
              {segment.playback.kind === 'placeholder' && (
                <div className="edl-reason">{segment.playback.reason}</div>
              )}
              {segment.playback.kind === 'video' && segment.playback.notice && (
                <div className="edl-reason">{segment.playback.notice}</div>
              )}
              <pre className="edl-detail">{segment.detail}</pre>
            </div>
          ) : (
            timeline && <p className="muted">区間の外です。タイムラインか章から移動できます。</p>
          )}

          <div className="edl-comments">
            <div className="edl-side-title">コメント</div>
            <p className="muted">この区間の時刻にメモします。EDL の隣の .comments.json に保存されます。N で入力へ。</p>
            <div className="edl-comment-form">
              <input
                ref={commentRef}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void submitComment();
                  }
                }}
                placeholder="この時刻のメモ"
              />
              <button onClick={() => void submitComment()} disabled={!timeline}>
                追加
              </button>
            </div>
            <ul>
              {segComments.map((c) => (
                <li key={c.id}>
                  <button className="ghost edl-comment-time" onClick={() => seek(c.timeSec)}>
                    {formatTime(c.timeSec)}
                  </button>
                  <span>{c.text}</span>
                  <button className="ghost" onClick={() => void deleteComment(c.id)}>
                    削除
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <details className="edl-fold">
            <summary>別の EDL を追加</summary>
            <AddForm
              pathInput={pathInput}
              cacheAdd={cacheAdd}
              onPath={setPathInput}
              onCache={setCacheAdd}
              onAdd={() => void addEdl()}
            />
          </details>

          <details className="edl-fold">
            <summary>パス置換</summary>
            <p className="muted">
              素材パスの先頭を置き換えます。保存されるのは from と to が両方入っている行です。WSL のディストリビューション名は、Windows から /home を \\wsl$ で読むときに使います。
            </p>
            {rewrites.map((r, i) => (
              <div className="edl-rewrite" key={i}>
                <input
                  value={r.from}
                  spellCheck={false}
                  placeholder="from"
                  onChange={(e) =>
                    setRewrites((rows) => rows.map((row, j) => (j === i ? { ...row, from: e.target.value } : row)))
                  }
                />
                <input
                  value={r.to}
                  spellCheck={false}
                  placeholder="to"
                  onChange={(e) =>
                    setRewrites((rows) => rows.map((row, j) => (j === i ? { ...row, to: e.target.value } : row)))
                  }
                />
                <button
                  className="ghost"
                  onClick={() => setRewrites((rows) => rows.filter((_, j) => j !== i))}
                >
                  削除
                </button>
              </div>
            ))}
            <button className="ghost" onClick={() => setRewrites((rows) => [...rows, { from: '', to: '' }])}>
              行を追加
            </button>
            <label className="edl-label">
              WSL ディストリビューション
              <input value={distro} onChange={(e) => setDistro(e.target.value)} placeholder="Ubuntu" spellCheck={false} />
            </label>
            <button onClick={() => void saveRewrites()}>パス置換を保存</button>
          </details>
        </aside>
      </div>
      {helpOpen && <HelpOverlay shortcuts={EDL_SHORTCUTS} onClose={() => toggleHelp(false)} />}
    </div>
  );
}

function AddForm({
  pathInput,
  cacheAdd,
  onPath,
  onCache,
  onAdd,
}: {
  pathInput: string;
  cacheAdd: string;
  onPath: (v: string) => void;
  onCache: (v: string) => void;
  onAdd: () => void;
}) {
  return (
    <form
      className="edl-add"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd();
      }}
    >
      <label className="edl-label">
        EDL JSON
        <input
          value={pathInput}
          onChange={(e) => onPath(e.target.value)}
          placeholder="EDL JSON のパス"
          spellCheck={false}
        />
      </label>
      <label className="edl-label">
        中間ファイルのフォルダ
        <input
          value={cacheAdd}
          onChange={(e) => onCache(e.target.value)}
          placeholder="任意。区間 mp4 のディレクトリ"
          spellCheck={false}
        />
      </label>
      <button className="primary" type="submit">
        読み込む
      </button>
    </form>
  );
}

function clampTime(t: number, dur: number): number {
  if (!Number.isFinite(t) || t < 0) return 0;
  if (!(dur > 0)) return 0;
  return Math.min(dur, t);
}

function rangeKey(items: { start: number; end: number }[], t: number, lead: number): string {
  let k = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    if (t >= it.start - lead && t < it.end) k += `${i},`;
  }
  return k;
}

function musicWindowKey(items: EdlMusicPlan[], t: number): string {
  let k = '';
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it?.url) continue;
    if (t >= it.start - 3 && t < it.end) k += `${i},`;
  }
  return k;
}

function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '不明なエラーが発生しました';
}
