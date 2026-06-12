import { useEffect, useRef, useState } from 'react';
import { api, thumbUrl } from '../api/client';
import { usePlayer } from './PlayerContext';
import { useAppStore, notesForClip } from '../store/useAppStore';
import {
  computeVisibleRange,
  indexToOffset,
  timeToIndex,
  scrollToCenter,
} from '../lib/thumbStrip';
import type { ThumbManifest } from '@veh/shared';

export function ThumbnailStrip() {
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

  // サムネ取得
  useEffect(() => {
    setIntervalSec(null);
    setTimes([]);
    let cancelled = false;

    api.getThumbs(p.clip.id).then(res => {
      if (cancelled) return;
      const manifest: ThumbManifest = res.manifest;
      const keys = Object.keys(manifest.intervals)
        .map(Number)
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

      for (const key of keys) {
        const arr = manifest.intervals[String(key)];
        if (arr && arr.length > 0) {
          setIntervalSec(key);
          setTimes(arr);
          return;
        }
      }
      // 全て空
      setIntervalSec(null);
      setTimes([]);
    }).catch(() => {
      if (cancelled) return;
      toast('サムネイルの取得に失敗しました', 'error');
    });

    return () => { cancelled = true; };
  }, [p.clip.id]);

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

  // 自動追従スクロール
  useEffect(() => {
    if (times.length === 0 || intervalSec === null) return;
    const el = scrollerRef.current;
    if (!el) return;
    if (Date.now() - lastUserScrollRef.current > 3000) {
      const currentIndex = timeToIndex(times, p.virtualTimeSec);
      const spacerWidth = times.length * 160;
      const maxScroll = spacerWidth - viewportWidth;
      const target = scrollToCenter(currentIndex, 160, viewportWidth, maxScroll);
      isProgrammaticScrollRef.current = true;
      el.scrollLeft = target;
    }
  }, [p.virtualTimeSec, times, intervalSec, viewportWidth]);

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

  if (intervalSec === null || times.length === 0) {
    return (
      <div className="strip">
        <div className="empty">サムネイル生成待ち</div>
      </div>
    );
  }

  const spacerWidth = times.length * 160;
  const maxScroll = spacerWidth - viewportWidth;
  const currentIndex = timeToIndex(times, p.virtualTimeSec);
  const { startIndex, endIndex } = computeVisibleRange({
    thumbWidth: 160,
    viewportWidth,
    scrollLeft,
    count: times.length,
    buffer: 4,
  });

  const notes = project ? notesForClip(project, p.clip.id) : [];
  const visibleNotes = notes.filter(n => n.status !== 'discarded');

  const thumbs: React.ReactNode[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    const t = times[i] ?? 0;
    const isCurrent = i === currentIndex;
    thumbs.push(
      <img
        key={i}
        className={isCurrent ? 'thumb current' : 'thumb'}
        src={thumbUrl(p.clip.id, intervalSec, t)}
        alt={String(t)}
        style={{
          position: 'absolute',
          left: indexToOffset(i, 160),
          width: 160,
        }}
        onClick={() => p.seekTo(t)}
      />
    );
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
        </div>
      </div>
    </div>
  );
}
