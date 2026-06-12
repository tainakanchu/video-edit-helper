import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  locateInFiles,
  totalDuration,
  virtualTime,
  type Clip,
  type FileSpan,
} from '@veh/shared';
import { mediaUrl } from '../api/client';
import { PLAYBACK_RATES, type PlaybackRate } from '../lib/keyboard';
import {
  commitOpen,
  createWatchedState,
  effectiveRanges,
  pendingRanges,
  rangesEqual,
  track,
  type WatchedTrackerState,
} from '../lib/watchedTracker';
import { useAppStore } from '../store/useAppStore';
import type { TimeRange } from '@veh/shared';

/**
 * 複数 SourceFile を 1 本の <video> で連結再生する仮想タイムライン。
 *
 * - 仮想時間(クリップ通し秒)で UI を統一。実ファイルへのマップは shared の
 *   locateInFiles / virtualTime を使う。
 * - ファイル末尾 ended → 次ファイルへ src 切替+自動再生継続。
 * - seekTo(virtualSec): 同一ファイル内なら currentTime、別ファイルなら
 *   src 切替 → loadedmetadata 後に currentTime + 再生状態復元。
 */
export interface PlayerApi {
  clip: Clip;
  fileSpans: FileSpan[];
  totalSec: number;

  videoRef: React.RefObject<HTMLVideoElement>;
  /** 現在表示中のファイルインデックス */
  fileIndex: number;
  /** 現在のファイルの src(playableInBrowser=false なら null) */
  currentSrc: string | null;
  currentFilePlayable: boolean;

  virtualTimeSec: number;
  playing: boolean;
  rate: PlaybackRate;
  watchedRanges: TimeRange[];

  seekTo: (virtualSec: number) => void;
  seekBy: (deltaSec: number) => void;
  togglePlay: () => void;
  setRate: (r: PlaybackRate) => void;
}

const PlayerContext = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}

function toSpans(clip: Clip): FileSpan[] {
  return clip.files.map((f) => ({
    id: f.id,
    startOffsetSec: f.startOffsetSec,
    durationSec: f.durationSec,
  }));
}

export function PlayerProvider({ clip, children }: { clip: Clip; children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileSpans = toSpans(clip);
  const totalSec = totalDuration(fileSpans);

  const [fileIndex, setFileIndex] = useState(0);
  const [virtualTimeSec, setVirtualTimeSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState<PlaybackRate>(1);

  // 視聴トラッキング
  const watchedRef = useRef<WatchedTrackerState>(createWatchedState(clip.watchedRanges));
  const sentRef = useRef<TimeRange[]>(clip.watchedRanges);
  const [watchedRanges, setWatchedRanges] = useState<TimeRange[]>(clip.watchedRanges);

  const mergeWatchedLocal = useAppStore((s) => s.mergeWatchedLocal);
  const pushWatched = useAppStore((s) => s.pushWatched);

  // src 切替後に復元したい状態(別ファイルへシークした時)
  const pendingSeekRef = useRef<{ offsetSec: number; resumePlay: boolean } | null>(null);

  const currentFile = clip.files[fileIndex];
  const currentFilePlayable = currentFile?.playableInBrowser ?? false;
  const currentSrc =
    currentFile && currentFile.playableInBrowser ? mediaUrl(currentFile.id) : null;

  // --- clip が変わったら状態をリセット ---
  useEffect(() => {
    watchedRef.current = createWatchedState(clip.watchedRanges);
    sentRef.current = clip.watchedRanges;
    setWatchedRanges(clip.watchedRanges);
    setFileIndex(0);
    setVirtualTimeSec(0);
    setPlaying(false);
    pendingSeekRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  // --- 視聴レンジのフラッシュ(5 秒ごと + アンマウント時) ---
  const flush = (force = false) => {
    const ranges = pendingRanges(watchedRef.current, sentRef.current);
    if (ranges.length === 0 && !force) return;
    if (rangesEqual(ranges, sentRef.current)) return;
    sentRef.current = ranges;
    mergeWatchedLocal(clip.id, ranges);
    void pushWatched(clip.id, ranges);
  };

  useEffect(() => {
    const t = setInterval(() => flush(), 5000);
    return () => {
      clearInterval(t);
      // クリップ離脱時: オープン中レンジを確定してフラッシュ
      watchedRef.current = commitOpen(watchedRef.current);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  // --- video 要素のイベント配線 ---
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      const vt = virtualTime(fileSpans, fileIndex, v.currentTime);
      setVirtualTimeSec(vt);
      watchedRef.current = track(watchedRef.current, vt, !v.paused, v.playbackRate);
      setWatchedRanges(effectiveRanges(watchedRef.current));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => {
      setPlaying(false);
      watchedRef.current = commitOpen(watchedRef.current);
      setWatchedRanges(effectiveRanges(watchedRef.current));
      flush();
    };
    const onEnded = () => {
      // 次のファイルへ
      if (fileIndex < clip.files.length - 1) {
        pendingSeekRef.current = { offsetSec: 0, resumePlay: true };
        setFileIndex(fileIndex + 1);
      } else {
        setPlaying(false);
      }
    };
    const onLoadedMetadata = () => {
      const pend = pendingSeekRef.current;
      if (pend) {
        pendingSeekRef.current = null;
        v.currentTime = Math.min(pend.offsetSec, v.duration || pend.offsetSec);
        if (pend.resumePlay) void v.play().catch(() => undefined);
      }
      v.playbackRate = rate;
    };
    const onRateChange = () => {
      const r = v.playbackRate as PlaybackRate;
      if (PLAYBACK_RATES.includes(r)) setRateState(r);
    };

    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('loadedmetadata', onLoadedMetadata);
    v.addEventListener('ratechange', onRateChange);
    return () => {
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('loadedmetadata', onLoadedMetadata);
      v.removeEventListener('ratechange', onRateChange);
    };
    // fileIndex / rate を依存に含め、ハンドラ内の参照を最新に保つ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileIndex, rate, clip.id]);

  // rate を video に反映
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate]);

  // --- 公開 API ---
  const seekTo = (virtualSec: number) => {
    const clamped = Math.min(Math.max(0, virtualSec), Math.max(0, totalSec - 0.05));
    const loc = locateInFiles(fileSpans, clamped);
    const v = videoRef.current;
    const wasPlaying = v ? !v.paused : playing;

    if (loc.index === fileIndex) {
      // 同一ファイル内
      if (v) v.currentTime = loc.offsetSec;
      setVirtualTimeSec(clamped);
    } else {
      // 別ファイル: src 切替 → loadedmetadata で offset 復元
      pendingSeekRef.current = { offsetSec: loc.offsetSec, resumePlay: wasPlaying };
      setFileIndex(loc.index);
      setVirtualTimeSec(clamped);
    }
  };

  const seekBy = (deltaSec: number) => seekTo(virtualTimeSec + deltaSec);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => undefined);
    else v.pause();
  };

  const setRate = (r: PlaybackRate) => {
    setRateState(r);
    const v = videoRef.current;
    if (v) v.playbackRate = r;
  };

  const api: PlayerApi = {
    clip,
    fileSpans,
    totalSec,
    videoRef,
    fileIndex,
    currentSrc,
    currentFilePlayable,
    virtualTimeSec,
    playing,
    rate,
    watchedRanges,
    seekTo,
    seekBy,
    togglePlay,
    setRate,
  };

  return <PlayerContext.Provider value={api}>{children}</PlayerContext.Provider>;
}
