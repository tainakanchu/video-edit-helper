/**
 * 外部 EDL（完成形の並び）の共有型と、再生・タイムラインが使う純関数。
 * 特定の作品には依存しない。
 */

export type EdlSegmentType =
  | 'rt'
  | 'hl'
  | 'ph'
  | 'photo'
  | 'photos'
  | 'black'
  | 'card'
  | 'opener';

export interface EdlChapter {
  title: string;
  start: number;
}

export interface EdlSegment {
  id: string;
  /** 未知の type も残す */
  type: string;
  start: number;
  dur: number;
  chapter: string;
  note: string;
  title?: string;
  sub?: string;
  name?: string;
  src?: string;
  srcWin?: string;
  a?: number;
  b?: number;
  speed?: number;
  gainDb?: number;
  hasAudio?: boolean;
  audio?: string;
  audioSrc?: string;
  audioSrcWin?: string;
  audioA?: number;
  file?: string;
  files?: string[];
  srcs?: string[];
  srcWins?: string[];
  zoom?: string;
  fit?: string;
  gap?: number;
}

export interface EdlMusic {
  id: string;
  file: string;
  cue: string;
  start: number;
  end: number;
  dur: number;
  trackIn: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  duck: boolean;
  trackPath?: string;
}

export interface EdlSubtitle {
  start: number;
  end: number;
  style: string;
  text: string;
}

export interface EdlXPost {
  id?: string;
  start: number;
  end: number;
  text: string;
  time?: string;
  pos?: string;
}

export interface EdlDocument {
  title: string;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  chapters: EdlChapter[];
  segments: EdlSegment[];
  music: EdlMusic[];
  subtitles: EdlSubtitle[];
  xposts: EdlXPost[];
}

export interface EdlSource {
  id: string;
  /** ユーザーが入力した EDL JSON のパス */
  path: string;
  label: string;
  /** 中間ファイルのフォルダ。未設定は空文字 */
  cacheDir: string;
}

export interface PathRewrite {
  from: string;
  to: string;
}

export interface EdlCacheStatus {
  configured: string;
  resolved: string | null;
}

export interface EdlPlaybackVideo {
  kind: 'video';
  url: string;
  mediaStartSec: number;
  timelineDur: number;
  /** video.playbackRate の素。マスターの再生速度はクライアントが掛ける */
  playbackRate: number;
  /** true なら速度がブラウザ上限を超え、シークで追従する */
  approximate: boolean;
  /** タイムライン 1 秒あたりの素材秒。中間ファイルは 1 */
  sourceSpeed: number;
  audible: boolean;
  gainDb: number;
  via: 'intermediate' | 'source' | 'proxy';
  notice?: string;
}

export interface EdlPlaybackImage {
  kind: 'image';
  urls: string[];
  gapSec: number | null;
  zoom?: string;
  fit?: string;
  timelineDur: number;
}

export interface EdlPlaybackCard {
  kind: 'card';
  title: string;
  sub: string;
  timelineDur: number;
}

export interface EdlPlaybackPlaceholder {
  kind: 'placeholder';
  reason: string;
  timelineDur: number;
}

export type EdlPlayback =
  | EdlPlaybackVideo
  | EdlPlaybackImage
  | EdlPlaybackCard
  | EdlPlaybackPlaceholder;

export interface EdlRealAudio {
  url: string;
  mediaStartSec: number;
}

export interface EdlSegmentPlan {
  id: string;
  type: string;
  start: number;
  dur: number;
  chapter: string;
  note: string;
  label: string;
  speed?: number;
  detail: string;
  playback: EdlPlayback;
  /** 中間が無く hl の audio=real のときだけ。中間があれば null */
  realAudio: EdlRealAudio | null;
}

export interface EdlMusicPlan {
  id: string;
  cue: string;
  start: number;
  end: number;
  dur: number;
  trackIn: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  duck: boolean;
  url: string | null;
  missingReason?: string;
}

export interface EdlTimeline {
  sourceId: string;
  title: string;
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  chapters: EdlChapter[];
  segments: EdlSegmentPlan[];
  music: EdlMusicPlan[];
  subtitles: EdlSubtitle[];
  xposts: EdlXPost[];
  cache: EdlCacheStatus;
  resolvedOn: 'win32' | 'posix';
}

export interface EdlComment {
  id: string;
  segmentId: string;
  timeSec: number;
  text: string;
  createdAt: string;
}

export interface EdlCommentsFile {
  version: 1;
  comments: EdlComment[];
}

/** HTMLMediaElement の playbackRate が実用上追従できる上限 */
export const EDL_BROWSER_MAX_RATE = 16;

export const EDL_SPEECH_STYLES = ['JA', 'ZH', 'ONO'] as const;

export function isSpeechStyle(style: string): boolean {
  return (EDL_SPEECH_STYLES as readonly string[]).includes(style);
}

/** 10^(dB/20) を 0..1 にクランプ。非有限は 1（原音） */
export function dbToGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  const lin = 10 ** (db / 20);
  if (!Number.isFinite(lin)) return 1;
  return Math.min(1, Math.max(0, lin));
}

/**
 * 音楽 cue の線形ゲイン。区間外は 0。
 * fadeIn / fadeOut は振幅の線形ランプ。duck かつ発話中は ×0.25。
 */
export function musicLinearGain(
  m: { gainDb: number; fadeIn: number; fadeOut: number; start: number; end: number; duck: boolean },
  t: number,
  speech: boolean,
): number {
  if (!Number.isFinite(t) || t < m.start || t >= m.end) return 0;
  let g = dbToGain(m.gainDb);
  const into = t - m.start;
  const left = m.end - t;
  if (m.fadeIn > 0 && into < m.fadeIn) g *= into / m.fadeIn;
  if (m.fadeOut > 0 && left < m.fadeOut) g *= left / m.fadeOut;
  if (m.duck && speech) g *= 0.25;
  return Math.min(1, Math.max(0, g));
}

const END_EPS = 1e-3;

/**
 * start 昇順の区間から、t を含むもののインデックス。
 * 半開区間 [start, start+dur)。最後の区間だけ終端を +1e-3 まで含む。
 * 隙間は -1。
 */
export function findSegmentIndex(items: { start: number; dur: number }[], t: number): number {
  if (items.length === 0 || !Number.isFinite(t)) return -1;
  let lo = 0;
  let hi = items.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = items[mid];
    if (!item) break;
    if (item.start <= t + 1e-6) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return -1;
  const seg = items[ans];
  if (!seg) return -1;
  const end = seg.start + seg.dur;
  const isLast = ans === items.length - 1;
  if (t < end || (isLast && t <= end + END_EPS)) return ans;
  const next = items[ans + 1];
  if (next && t >= next.start - END_EPS && t < next.start + next.dur) return ans + 1;
  return -1;
}

/**
 * 区間単位の移動。
 * +1 は t より後で最初の区間の start。無ければ最終区間の終端。
 * -1 は、現在区間に 0.25 秒より深く入っていればその start、そうでなければ前の区間の start。
 */
export function stepSegment(
  items: { start: number; dur: number }[],
  t: number,
  dir: 1 | -1,
): number {
  if (items.length === 0) return Math.max(0, Number.isFinite(t) ? t : 0);
  if (dir === 1) {
    for (const s of items) {
      if (s.start > t + 0.05) return s.start;
    }
    const last = items[items.length - 1]!;
    return last.start + last.dur;
  }
  const i = findSegmentIndex(items, t);
  if (i >= 0) {
    const cur = items[i]!;
    if (t > cur.start + 0.25) return cur.start;
    if (i > 0) return items[i - 1]!.start;
    return 0;
  }
  let prev = 0;
  let found = false;
  for (const s of items) {
    if (s.start < t - 0.05) {
      prev = s.start;
      found = true;
    }
  }
  return found ? prev : 0;
}

/** chapters は start 昇順。+1 は次の章、無ければ最後の章。-1 は前の章、無ければ 0 */
export function stepChapter(chapters: { start: number }[], t: number, dir: 1 | -1): number {
  if (chapters.length === 0) return Math.max(0, Number.isFinite(t) ? t : 0);
  if (dir === 1) {
    for (const c of chapters) {
      if (c.start > t + 0.05) return c.start;
    }
    return chapters[chapters.length - 1]!.start;
  }
  let prev = 0;
  let found = false;
  for (const c of chapters) {
    if (c.start < t - 0.05) {
      prev = c.start;
      found = true;
    }
  }
  return found ? prev : 0;
}

/** t が [start, end) に入るか。件数は数百を想定した線形探索 */
export function isTimeCovered(ranges: { start: number; end: number }[], t: number): boolean {
  for (const r of ranges) {
    if (t >= r.start && t < r.end) return true;
  }
  return false;
}
