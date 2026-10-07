/**
 * 横スクロールの EDL タイムライン。可視範囲だけ描く。
 * 再生ヘッドの transform は親が毎フレーム書き、ここはスクロールとホバーを持つ。
 */
import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import { findSegmentIndex, type EdlComment, type EdlSegmentPlan, type EdlTimeline } from '@veh/shared';
import { intersects, visibleTimeRange } from '../lib/edlLayout';

const OVERSCAN = 240;
const SEG_CLASS: Record<string, string> = {
  rt: 'edl-seg-rt',
  hl: 'edl-seg-hl',
  ph: 'edl-seg-ph',
  photo: 'edl-seg-photo',
  photos: 'edl-seg-photos',
  black: 'edl-seg-black',
  card: 'edl-seg-card',
  opener: 'edl-seg-opener',
};

interface EdlTracksProps {
  timeline: EdlTimeline;
  comments: EdlComment[];
  pxPerSec: number;
  currentId: string | null;
  timeRef: RefObject<number>;
  playheadRef: RefObject<HTMLDivElement>;
  scrollerRef: RefObject<HTMLDivElement>;
  autoScrollingRef: MutableRefObject<boolean>;
  onUserScroll: () => void;
  onSeek: (t: number) => void;
  onZoom: (factor: number, cursorX: number, scrollLeft: number, width: number) => void;
}

export function EdlTracks({
  timeline,
  comments,
  pxPerSec,
  currentId,
  timeRef,
  playheadRef,
  scrollerRef,
  autoScrollingRef,
  onUserScroll,
  onSeek,
  onZoom,
}: EdlTracksProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<{ seg: EdlSegmentPlan; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const read = () => {
      setWidth(el.clientWidth);
      setScrollLeft(el.scrollLeft);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollerRef, timeline.sourceId]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      onZoom(factor, e.clientX - rect.left, el.scrollLeft, el.clientWidth);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollerRef, onZoom, timeline.sourceId]);

  useLayoutEffect(() => {
    const head = playheadRef.current;
    const t = timeRef.current ?? 0;
    if (head) head.style.transform = `translateX(${t * pxPerSec}px)`;
  });

  const px = pxPerSec > 0 ? pxPerSec : 1;
  const range = visibleTimeRange({ scrollLeft, width: width || 1, pxPerSec: px }, OVERSCAN);
  const innerW = Math.max(1, timeline.durationSec * px);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollLeft(el.scrollLeft);
    if (autoScrollingRef.current) return;
    onUserScroll();
  };

  const seekFromEvent = (clientX: number) => {
    const inner = innerRef.current;
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    onSeek((clientX - rect.left) / px);
  };

  return (
    <div className="edl-tracks">
      <div className="edl-gutter" aria-hidden="true">
        <div className="edl-gutter-row ch">章</div>
        <div className="edl-gutter-row v">映像</div>
        <div className="edl-gutter-row m">音楽</div>
        <div className="edl-gutter-row s">字幕</div>
        <div className="edl-gutter-row x">X</div>
        <div className="edl-gutter-row c">メモ</div>
      </div>
      <div className="edl-scroll" ref={scrollerRef} onScroll={onScroll}>
        <div
          className="edl-inner"
          ref={innerRef}
          style={{ width: innerW }}
          onClick={(e) => seekFromEvent(e.clientX)}
          onMouseMove={(e) => {
            const inner = innerRef.current;
            if (!inner) return;
            const rect = inner.getBoundingClientRect();
            const t = (e.clientX - rect.left) / px;
            const i = findSegmentIndex(timeline.segments, t);
            const seg = i >= 0 ? timeline.segments[i] : undefined;
            if (!seg) {
              setHover(null);
              return;
            }
            setHover({ seg, x: e.clientX + 14, y: e.clientY + 14 });
          }}
          onMouseLeave={() => setHover(null)}
        >
          <div className="edl-playhead" ref={playheadRef} />
          <div className="edl-lane ch">
            {timeline.chapters.map((c, i) => {
              if (c.start >= range.end || c.start + 30 < range.start) return null;
              const next = timeline.chapters[i + 1]?.start ?? timeline.durationSec;
              const w = Math.max(24, (next - c.start) * px);
              return (
                <div key={`${c.start}-${i}`} className="edl-ch" style={{ left: c.start * px, width: w }}>
                  {c.title}
                </div>
              );
            })}
          </div>
          <div className="edl-lane v">
            {timeline.segments.map((seg) => {
              const end = seg.start + seg.dur;
              if (!intersects(seg.start, end, range.start, range.end)) return null;
              const w = Math.max(2, seg.dur * px);
              const cls = SEG_CLASS[seg.type] ?? 'edl-seg-other';
              return (
                <div
                  key={seg.id}
                  className={`edl-seg ${cls}${seg.id === currentId ? ' current' : ''}`}
                  style={{ left: seg.start * px, width: w }}
                >
                  {w > 36 ? seg.label : ''}
                </div>
              );
            })}
          </div>
          <div className="edl-lane m">
            {timeline.music.map((m) => {
              if (!intersects(m.start, m.end, range.start, range.end)) return null;
              const w = Math.max(2, (m.end - m.start) * px);
              const fadeIn = m.dur > 0 ? Math.min(45, (m.fadeIn / m.dur) * 100) : 0;
              const fadeOut = m.dur > 0 ? Math.min(45, (m.fadeOut / m.dur) * 100) : 0;
              return (
                <div
                  key={m.id}
                  className={m.missingReason ? 'edl-music missing' : 'edl-music'}
                  style={{
                    left: m.start * px,
                    width: w,
                    background: m.missingReason
                      ? undefined
                      : `linear-gradient(90deg, transparent, #7eb6ff ${fadeIn}%, #7eb6ff ${100 - fadeOut}%, transparent)`,
                  }}
                  title={m.missingReason}
                >
                  {w > 48 ? m.cue || m.missingReason || '' : ''}
                </div>
              );
            })}
          </div>
          <div className="edl-lane s">
            {timeline.subtitles.map((s, i) => {
              if (!intersects(s.start, s.end, range.start, range.end)) return null;
              return (
                <div
                  key={`${s.start}-${i}`}
                  className={`edl-sub edl-sub-${s.style}`}
                  style={{ left: s.start * px, width: Math.max(1, (s.end - s.start) * px) }}
                />
              );
            })}
          </div>
          <div className="edl-lane x">
            {timeline.xposts.map((post, i) => {
              if (!intersects(post.start, post.end, range.start, range.end)) return null;
              return (
                <div
                  key={`${post.start}-${i}`}
                  className="edl-xbar"
                  style={{ left: post.start * px, width: Math.max(2, (post.end - post.start) * px) }}
                />
              );
            })}
          </div>
          <div className="edl-lane c">
            {comments.map((c) => {
              if (!intersects(c.timeSec, c.timeSec + 0.05, range.start, range.end)) return null;
              return <div key={c.id} className="edl-tick" style={{ left: c.timeSec * px }} />;
            })}
          </div>
        </div>
      </div>
      {hover && (
        <div
          className="edl-tip"
          style={{
            left: Math.min(hover.x, window.innerWidth - 340),
            top: hover.y + 180 > window.innerHeight ? hover.y - 170 : hover.y,
          }}
        >
          <TipBody seg={hover.seg} subtitles={timeline.subtitles} />
        </div>
      )}
    </div>
  );
}

function TipBody({ seg, subtitles }: { seg: EdlSegmentPlan; subtitles: EdlTimeline['subtitles'] }) {
  const telop = telopOf(seg, subtitles);
  const reason = reasonOf(seg);
  return (
    <>
      <div className="edl-tip-label">{seg.label}</div>
      <pre>{seg.detail}</pre>
      {telop ? <pre className="edl-tip-telop">{telop}</pre> : null}
      {reason ? <div className="edl-tip-reason">{reason}</div> : null}
    </>
  );
}

function telopOf(seg: EdlSegmentPlan, subs: EdlTimeline['subtitles']): string {
  const end = seg.start + seg.dur;
  const lines: string[] = [];
  for (const s of subs) {
    if (s.end <= seg.start || s.start >= end || !s.text) continue;
    lines.push(`${s.style}: ${s.text}`);
    if (lines.length >= 4) break;
  }
  return lines.join('\n');
}

function reasonOf(seg: EdlSegmentPlan): string {
  const p = seg.playback;
  if (p.kind === 'placeholder') return p.reason;
  if (p.kind === 'video' && p.notice) return p.notice;
  if (p.kind === 'video' && p.via === 'proxy') return 'プロキシを再生';
  return '';
}
