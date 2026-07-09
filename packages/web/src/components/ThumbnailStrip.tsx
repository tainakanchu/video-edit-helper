import { useEffect, useMemo, useRef, useState } from 'react';
import { api, thumbUrl } from '../api/client';
import { usePlayer } from './PlayerContext';
import { useAppStore, notesForClip, projectSelections } from '../store/useAppStore';
import {
  buildSlotMap,
  computeSlotCount,
  computeVisibleRange,
  indexToOffset,
  minIntervalCoverage,
  scrollToCenter,
  selectInterval,
  timeToSlot,
} from '../lib/thumbStrip';
import { selectionsForClip } from '../lib/selection';

interface ThumbnailStripProps {
  /** ペンディング中のイン点(秒)。ストリップにマーカー表示 */
  pendingInSec?: number | null;
  /** シーン転換点(秒)。ストリップに細い縦線で表示 */
  sceneTimes?: number[] | null;
}

/** サムネ生成が未完のときの再取得間隔(ms) */
const POLL_INTERVAL_MS = 5000;

export function ThumbnailStrip({ pendingInSec, sceneTimes }: ThumbnailStripProps) {
  const p = usePlayer();
  const project = useAppStore(s => s.project);
  const toast = useAppStore(s => s.toast);

  const [intervalSec, setIntervalSec] = useState<number | null>(null);
  const [times, setTimes] = useState<number[]>([]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(800);

  const lastUserScrollRef = useRef<number>(0);
  const isProgrammaticScrollRef = useRef<boolean>(false);

  // サムネ取得。裏で生成が進んでいる間(最密 interval が未完)は 5 秒間隔で再取得する
  useEffect(() => {
    setIntervalSec(null);
    setTimes([]);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const fetchOnce = () => {
      api.getThumbs(p.clip.id).then(res => {
        if (cancelled) return;
        const manifest = res.manifest;
        const sel = selectInterval(manifest.intervals, p.totalSec);
        if (sel) {
          setIntervalSec(sel.intervalSec);
          setTimes(sel.times);
        } else {
          setIntervalSec(null);
          setTimes([]);
        }
        if (minIntervalCoverage(manifest.intervals, p.totalSec) < 1) {
          timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
        }
      }).catch(() => {
        if (cancelled) return;
        toast('サムネイルの取得に失敗しました', 'error');
      });
    };

    fetchOnce();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [p.clip.id, p.totalSec]);

  // ResizeObserver
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setViewportWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // スロット総数はクリップ全長 × interval のみで決まる(生成済み枚数に依存しない)
  const slotCount = intervalSec !== null ? computeSlotCount(p.totalSec, intervalSec) : 0;

  // 自動追従スクロール
  useEffect(() => {
    if (intervalSec === null || slotCount === 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (Date.now() - lastUserScrollRef.current > 3000) {
      const currentSlot = timeToSlot(p.virtualTimeSec, intervalSec, slotCount);
      const spacerWidth = slotCount * 160;
      const maxScroll = spacerWidth - viewportWidth;
      const target = scrollToCenter(currentSlot, 160, viewportWidth, maxScroll);
      isProgrammaticScrollRef.current = true;
      el.scrollLeft = target;
    }
  }, [p.virtualTimeSec, intervalSec, slotCount, viewportWidth]);

  const handleScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    lastUserScrollRef.current = Date.now();
    setScrollLeft(el.scrollLeft);
  };

  const slotMap = useMemo(() => {
    if (intervalSec === null) return new Map<number, number>();
    return buildSlotMap(times, intervalSec, slotCount);
  }, [times, intervalSec, slotCount]);

  if (intervalSec === null || slotCount === 0) {
    return (
      <div className="strip">
        <div className="empty">サムネイル生成待ち</div>
      </div>
    );
  }

  const spacerWidth = slotCount * 160;
  const maxScroll = spacerWidth - viewportWidth;
  const currentSlot = timeToSlot(p.virtualTimeSec, intervalSec, slotCount);
  const { startIndex, endIndex } = computeVisibleRange({
    thumbWidth: 160,
    viewportWidth,
    scrollLeft,
    count: slotCount,
    buffer: 4,
  });

  const notes = project ? notesForClip(project, p.clip.id) : [];
  const visibleNotes = notes.filter(n => n.status !== 'discarded');
  const selections = project ? selectionsForClip(projectSelections(project), p.clip.id) : [];

  const thumbs: React.ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const isCurrent = i === currentSlot;
    const generatedTime = slotMap.get(i);
    if (generatedTime !== undefined) {
      thumbs.push(
        <img
          key={i}
          className={isCurrent ? 'thumb current' : 'thumb'}
          src={thumbUrl(p.clip.id, intervalSec, generatedTime)}
          alt={String(generatedTime)}
          style={{
            position: 'absolute',
            left: indexToOffset(i, 160),
            width: 160,
          }}
          onClick={() => p.seekTo(generatedTime)}
        />,
      );
    } else {
      // 未生成スロット: k*intervalSec へのシーク導線を残しつつ控えめなプレースホルダを出す
      const slotTimeSec = i * intervalSec;
      thumbs.push(
        <div
          key={i}
          className={isCurrent ? 'thumb pending current' : 'thumb pending'}
          style={{
            position: 'absolute',
            left: indexToOffset(i, 160),
            width: 160,
          }}
          onClick={() => p.seekTo(slotTimeSec)}
          title="サムネイル未生成"
        >
          ⋯
        </div>,
      );
    }
  }

  return (
    <div className="strip">
      <div
        className="scroller"
        ref={scrollerRef}
        onScroll={handleScroll}
        style={{ overflowX: 'scroll', position: 'relative' }}
      >
        <div
          className="spacer"
          style={{ width: spacerWidth, position: 'relative', height: '90px' }}
        >
          {thumbs}
          {visibleNotes.map(note => (
            <div
              key={note.id}
              className="pin"
              style={{
                left: (note.timeSec / p.totalSec) * spacerWidth,
                position: 'absolute',
              }}
              onClick={() => p.seekTo(note.timeSec)}
              title={note.text}
            >
              📌
            </div>
          ))}
          {p.watchedRanges.map((r, idx) => (
            <div
              key={idx}
              className="watched-bar"
              style={{
                left: (r.start / p.totalSec) * spacerWidth,
                width: ((r.end - r.start) / p.totalSec) * spacerWidth,
                position: 'absolute',
              }}
            />
          ))}
          {selections.map(s => (
            <div
              key={s.id}
              className="sel-bar"
              style={{
                left: (s.inSec / p.totalSec) * spacerWidth,
                width: ((s.outSec - s.inSec) / p.totalSec) * spacerWidth,
                position: 'absolute',
              }}
              title={`選定 ${s.inSec.toFixed(0)}–${s.outSec.toFixed(0)}s`}
            />
          ))}
          {pendingInSec != null && (
            <div
              className="in-mark-strip"
              style={{
                left: (pendingInSec / p.totalSec) * spacerWidth,
                position: 'absolute',
              }}
              title="イン点(ペンディング)"
            />
          )}
          {sceneTimes?.map((t, idx) =>
            t > 0 && t < p.totalSec ? (
              <div
                key={`scene-${idx}`}
                className="scene-mark-strip"
                style={{
                  left: (t / p.totalSec) * spacerWidth,
                  position: 'absolute',
                }}
                title="シーン転換"
              />
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
