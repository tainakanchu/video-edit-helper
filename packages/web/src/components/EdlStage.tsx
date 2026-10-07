/**
 * EDL のプレビュー画面。マスタークロックは親が持ち、sync() で映像・音声を追従させる。
 * video は 2 枚。次の区間を裏で先読みし、準備できていれば境界で入れ替える。
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import {
  EDL_BROWSER_MAX_RATE,
  dbToGain,
  isTimeCovered,
  musicLinearGain,
  type EdlMusicPlan,
  type EdlPlaybackVideo,
  type EdlSegmentPlan,
  type EdlSubtitle,
  type EdlXPost,
} from '@veh/shared';
import { photoIndex } from '../lib/edlLayout';

export interface EdlPreload {
  id: string;
  video: EdlPlaybackVideo;
}

export interface EdlStageHandle {
  /** eager はユーザー操作の直後。play() を待たずに掛ける */
  sync: (t: number, playing: boolean, eager?: boolean) => void;
}

interface EdlStageProps {
  segment: EdlSegmentPlan | null;
  preload: EdlPreload | null;
  subtitles: EdlSubtitle[];
  xposts: EdlXPost[];
  music: EdlMusicPlan[];
  speechRanges: { start: number; end: number }[];
  rate: number;
  audioGain: number;
  audioMuted: boolean;
  audioSinkId: string;
}

const OV_STYLES = new Set([
  'LT',
  'CTX',
  'JA',
  'ZH',
  'MUSIC',
  'CREDIT',
  'ONO',
  'TITLE',
  'TITLESUB',
]);

export const EdlStage = forwardRef<EdlStageHandle, EdlStageProps>(function EdlStage(props, ref) {
  const propsRef = useRef(props);
  propsRef.current = props;

  const v0 = useRef<HTMLVideoElement | null>(null);
  const v1 = useRef<HTMLVideoElement | null>(null);
  const frontRef = useRef(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const realRef = useRef<HTMLAudioElement>(null);
  const musicRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const failedRef = useRef<Set<string>>(new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const videoSeekAt = useRef(0);
  const realSeekAt = useRef(0);
  const musicSeekAt = useRef<Map<string, number>>(new Map());
  const [blocked, setBlocked] = useState(false);
  const blockedRef = useRef(false);

  const bind0 = useCallback((el: HTMLVideoElement | null) => {
    v0.current = el;
    el?.classList.add('back');
  }, []);
  const bind1 = useCallback((el: HTMLVideoElement | null) => {
    v1.current = el;
    el?.classList.add('back');
  }, []);

  const markFailed = (id: string) => {
    if (failedRef.current.has(id)) return;
    failedRef.current.add(id);
    setFailedIds(new Set(failedRef.current));
  };

  const sync = (t: number, playing: boolean, eager = false) => {
    const p = propsRef.current;
    syncVideo(t, playing, eager);
    syncImage(t);
    syncReal(t, playing, eager);
    syncMusic(t, playing, eager, p);
    applySinks(p.audioSinkId);
  };

  useImperativeHandle(ref, () => ({ sync }));

  const segment = props.segment;
  const pb = segment?.playback ?? null;
  const failed = segment ? failedIds.has(segment.id) : false;
  const showVideo = pb?.kind === 'video' && !failed;
  const showImage = pb?.kind === 'image' && !failed && pb.urls.length > 0;
  const showCard = pb?.kind === 'card' && !failed;
  const reason = failed
    ? '再生できませんでした'
    : pb?.kind === 'placeholder'
      ? pb.reason
      : pb?.kind === 'image' && pb.urls.length === 0
        ? '画像が見つかりません'
        : !segment
          ? '区間がありません'
          : null;
  const notice = showVideo && pb?.kind === 'video' ? pb.notice : undefined;

  return (
    <div className="edl-stage">
      <video ref={bind0} muted playsInline preload="auto" onError={onVideoError} />
      <video ref={bind1} muted playsInline preload="auto" onError={onVideoError} />
      {showImage && pb?.kind === 'image' && (
        <img
          ref={imgRef}
          className={stillClass(pb.fit, pb.zoom)}
          alt={segment?.label ?? ''}
          onError={() => {
            if (segment) markFailed(segment.id);
          }}
        />
      )}
      {showCard && pb?.kind === 'card' && (
        <div className="edl-card">
          <h2>{pb.title || segment?.label}</h2>
          {pb.sub ? <p>{pb.sub}</p> : null}
        </div>
      )}
      {reason && !showVideo && !showImage && !showCard && (
        <div className="edl-placeholder">{reason}</div>
      )}
      <div className="edl-overlays">
        {props.subtitles.map((s, i) => (
          <div key={`${s.style}-${s.start}-${i}`} className={ovClass(s.style)} style={ovPlace(s.style, i)}>
            {s.text}
          </div>
        ))}
        {props.xposts.map((post, i) => (
          <div
            key={`${post.start}-${i}`}
            className={post.pos === 'center' ? 'edl-x edl-x-center' : 'edl-x edl-x-corner'}
            style={post.pos === 'center' ? undefined : { top: 12 + i * 76 }}
          >
            {post.time ? <div className="edl-x-time">{post.time}</div> : null}
            <div>{post.text}</div>
          </div>
        ))}
      </div>
      {notice && <div className="edl-notice">{notice}</div>}
      {blocked && <div className="edl-notice edl-notice-block">再生ボタンをもう一度押すと映像と音声が続きます</div>}
      <audio ref={realRef} muted preload="auto" />
      {props.music.map((m) =>
        m.url ? (
          <audio
            key={m.id}
            muted
            preload="auto"
            src={m.url}
            ref={(el) => {
              if (el) musicRefs.current.set(m.id, el);
              else musicRefs.current.delete(m.id);
            }}
          />
        ) : null,
      )}
    </div>
  );

  function onVideoError(e: React.SyntheticEvent<HTMLVideoElement>) {
    const id = e.currentTarget.dataset.seg;
    if (!id) return;
    markFailed(id);
  }

  function videos(): Array<HTMLVideoElement | null> {
    return [v0.current, v1.current];
  }

  function syncVideo(t: number, playing: boolean, eager: boolean) {
    const p = propsRef.current;
    const seg = p.segment;
    const video = seg?.playback.kind === 'video' ? seg.playback : null;
    const els = videos();
    const broken = !!(seg && failedRef.current.has(seg.id));
    if (!seg || !video || broken) {
      for (const el of els) {
        if (el && !el.paused) el.pause();
        el?.classList.add('back');
      }
      return;
    }

    const backIdx = 1 - frontRef.current;
    const back = els[backIdx];
    const frontEl = els[frontRef.current];
    if (
      back &&
      back.dataset.seg === seg.id &&
      back.dataset.url === video.url &&
      back.readyState >= 2 &&
      frontEl?.dataset.seg !== seg.id
    ) {
      frontRef.current = backIdx;
    }

    const el = els[frontRef.current];
    if (el && (el.dataset.url !== video.url || el.dataset.seg !== seg.id)) {
      if (el.dataset.url !== video.url) {
        el.src = video.url;
        el.dataset.url = video.url;
      }
      el.dataset.seg = seg.id;
    }

    const show = els[frontRef.current];
    const other = els[1 - frontRef.current];
    if (other) {
      other.classList.add('back');
      other.muted = true;
      if (!other.paused) other.pause();
    }
    const preload = p.preload;
    if (other && preload && preload.id !== seg.id && other.dataset.seg !== preload.id) {
      other.dataset.seg = preload.id;
      other.dataset.url = preload.video.url;
      other.src = preload.video.url;
      other.muted = true;
      other.pause();
    } else if (other && preload && other.dataset.seg === preload.id && other.readyState >= 1) {
      const at = preload.video.mediaStartSec;
      if (Math.abs(other.currentTime - at) > 0.35) {
        try {
          other.currentTime = at;
        } catch {
          /* 先読みのシークは失敗してもよい */
        }
      }
    }

    if (!show) return;
    show.classList.remove('back');
    const elapsed = Math.max(0, t - seg.start);
    const expected = video.mediaStartSec + elapsed * video.sourceSpeed;
    setPlayRate(show, Math.min(EDL_BROWSER_MAX_RATE, video.playbackRate * safeRate(p.rate)));
    if (Number.isFinite(expected) && Math.abs(show.currentTime - expected) > 0.35) {
      const throttle = video.approximate ? 200 : 80;
      const now = performance.now();
      if (eager || now - videoSeekAt.current >= throttle) {
        try {
          show.currentTime = Math.max(0, expected);
          videoSeekAt.current = now;
        } catch {
          /* メタデータ前は次のフレームでやり直す */
        }
      }
    }
    const gain = !video.audible || p.audioMuted ? 0 : Math.min(1, dbToGain(video.gainDb) * p.audioGain);
    applyGain(show, gain);
    if (playing) startPlay(show, eager);
    else if (!show.paused) show.pause();
  }

  function syncImage(t: number) {
    const p = propsRef.current;
    const seg = p.segment;
    const img = imgRef.current;
    if (!img || !seg || seg.playback.kind !== 'image') return;
    if (failedRef.current.has(seg.id)) return;
    const urls = seg.playback.urls;
    if (urls.length === 0) return;
    const idx = photoIndex(t - seg.start, urls.length, seg.playback.timelineDur, seg.playback.gapSec);
    const url = urls[idx] ?? '';
    if (!url || img.dataset.url === url) return;
    img.dataset.url = url;
    img.src = url;
    if (seg.playback.zoom === 'in') {
      img.style.animation = 'none';
      void img.offsetWidth;
      img.style.animation = '';
    }
  }

  function syncReal(t: number, playing: boolean, eager: boolean) {
    const p = propsRef.current;
    const seg = p.segment;
    const el = realRef.current;
    if (!el) return;
    const real = seg?.realAudio ?? null;
    const broken = !!(seg && failedRef.current.has(seg.id));
    if (!seg || !real || broken) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.dataset.url !== real.url) {
      el.dataset.url = real.url;
      el.src = real.url;
    }
    const expected = real.mediaStartSec + Math.max(0, t - seg.start);
    setPlayRate(el, safeRate(p.rate));
    if (Number.isFinite(expected) && el.readyState >= 1 && Math.abs(el.currentTime - expected) > 0.4) {
      const now = performance.now();
      if (eager || now - realSeekAt.current >= 150) {
        try {
          el.currentTime = Math.max(0, expected);
          realSeekAt.current = now;
        } catch {
          /* 次のフレームで */
        }
      }
    }
    const gainDb = seg.playback.kind === 'video' ? seg.playback.gainDb : 0;
    const gain = p.audioMuted ? 0 : Math.min(1, dbToGain(gainDb) * p.audioGain);
    applyGain(el, gain);
    if (playing) startPlay(el, eager);
    else if (!el.paused) el.pause();
  }

  function syncMusic(
    t: number,
    playing: boolean,
    eager: boolean,
    p: EdlStageProps,
  ) {
    const speech = isTimeCovered(p.speechRanges, t);
    for (const cue of p.music) {
      const el = musicRefs.current.get(cue.id);
      if (!el || !cue.url) continue;
      setPlayRate(el, safeRate(p.rate));
      if (t < cue.start) {
        if (el.readyState >= 1 && Math.abs(el.currentTime - cue.trackIn) > 0.4) {
          try {
            el.currentTime = cue.trackIn;
          } catch {
            /* 先読み中 */
          }
        }
        applyGain(el, 0);
        if (!el.paused) el.pause();
        continue;
      }
      const expected = cue.trackIn + (t - cue.start);
      if (el.readyState >= 1 && Number.isFinite(expected) && Math.abs(el.currentTime - expected) > 0.4) {
        const now = performance.now();
        const prev = musicSeekAt.current.get(cue.id) ?? 0;
        if (eager || now - prev >= 150) {
          try {
            el.currentTime = Math.max(0, expected);
            musicSeekAt.current.set(cue.id, now);
          } catch {
            /* 次のフレームで */
          }
        }
      }
      const gain = p.audioMuted ? 0 : Math.min(1, musicLinearGain(cue, t, speech) * p.audioGain);
      applyGain(el, gain);
      const inCue = t < cue.end;
      if (playing && inCue) startPlay(el, eager);
      else if (!el.paused) el.pause();
    }
  }

  function startPlay(el: HTMLMediaElement, eager: boolean) {
    if (!el.paused) return;
    const now = performance.now();
    const prev = Number(el.dataset.playAt || 0);
    if (!eager && now - prev < 400) return;
    el.dataset.playAt = String(now);
    const attempt = el.play();
    if (!attempt) return;
    void attempt.then(
      () => {
        if (!blockedRef.current) return;
        blockedRef.current = false;
        setBlocked(false);
      },
      (err: unknown) => {
        const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: string }).name) : '';
        if (name !== 'NotAllowedError' || blockedRef.current) return;
        blockedRef.current = true;
        setBlocked(true);
      },
    );
  }

  function applySinks(sinkId: string) {
    if (!sinkId) return;
    const els: Array<HTMLMediaElement | null> = [
      v0.current,
      v1.current,
      realRef.current,
      ...musicRefs.current.values(),
    ];
    for (const el of els) applySink(el, sinkId);
  }
});

function stillClass(fit: string | undefined, zoom: string | undefined): string {
  const parts = ['edl-still'];
  if (fit === 'contain') parts.push('contain');
  if (zoom === 'in') parts.push('zoom-in');
  return parts.join(' ');
}

function ovClass(style: string): string {
  return OV_STYLES.has(style) ? `edl-ov edl-ov-${style}` : 'edl-ov edl-ov-other';
}

function ovPlace(style: string, index: number): { top?: number; bottom?: number } {
  const step = index * 28;
  switch (style) {
    case 'LT':
      return { top: 28 + step };
    case 'CTX':
      return { top: 78 + step };
    case 'TITLE':
      return { top: 120 + step };
    case 'TITLESUB':
      return { top: 168 + step };
    case 'JA':
      return { bottom: 28 + step };
    case 'ZH':
      return { bottom: 64 + step };
    default:
      return { bottom: 108 + step };
  }
}

function safeRate(rate: number): number {
  if (!Number.isFinite(rate) || rate <= 0) return 1;
  return Math.min(EDL_BROWSER_MAX_RATE, rate);
}

function setPlayRate(el: HTMLMediaElement, rate: number) {
  const r = Math.min(EDL_BROWSER_MAX_RATE, Math.max(0.25, rate));
  if (el.playbackRate === r) return;
  try {
    el.playbackRate = r;
  } catch {
    /* 環境が速度を拒否してもクロックは進める */
  }
}

function applyGain(el: HTMLMediaElement, gain: number) {
  const g = Math.min(1, Math.max(0, gain));
  el.muted = g <= 0.001;
  if (Math.abs(el.volume - g) > 0.002) el.volume = g <= 0.001 ? 0 : g;
}

function applySink(el: HTMLMediaElement | null, sinkId: string) {
  if (!el || !sinkId) return;
  const withSink = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== 'function') return;
  if (el.dataset.sink === sinkId) return;
  el.dataset.sink = sinkId;
  void withSink.setSinkId(sinkId).catch(() => undefined);
}
