import {
  EDL_BROWSER_MAX_RATE,
  type EdlDocument,
  type EdlMusic,
  type EdlMusicPlan,
  type EdlPlayback,
  type EdlSegment,
  type EdlSegmentPlan,
  type EdlTimeline,
  type PathRewrite,
} from '@veh/shared';
import {
  joinEdlPath,
  orderedMediaCandidates,
  resolveEdlPath,
  type PathResolveOpts,
} from './paths.js';

export interface PlanContext {
  sourceId: string;
  platform: NodeJS.Platform;
  exists: (p: string) => boolean;
  cacheDir: string;
  rewrites: PathRewrite[];
  wslDistro: string;
  assetUrl: (role: 'segment' | 'source' | 'image' | 'realaudio' | 'music', key: string) => string;
  /**
   * スキャン済みで、再生不可かつプロキシ生成済みのファイルならその配信 URL。
   * 中間ファイルがある区間では使わない。
   */
  findProxyUrl?: (resolvedPath: string) => string | null;
  /** 中間ファイルの付帯情報（`<file>.json`）を読む。無ければ null。未指定なら検証しない */
  readText?: (p: string) => string | null;
}

function optsOf(ctx: PlanContext): PathResolveOpts {
  return {
    platform: ctx.platform,
    exists: ctx.exists,
    rewrites: ctx.rewrites,
    wslDistro: ctx.wslDistro,
  };
}

function baseName(p: string | undefined): string {
  if (!p) return '';
  const norm = p.replaceAll('\\', '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function extOf(p: string): string {
  const base = baseName(p);
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i + 1).toLowerCase() : '';
}

function isHeic(p: string): boolean {
  const ext = extOf(p);
  return ext === 'heic' || ext === 'heif';
}

function isAbsoluteLike(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(p);
}

function labelOf(seg: EdlSegment): string {
  switch (seg.type) {
    case 'hl':
      return `${seg.id} ×${seg.speed ?? '?'}`;
    case 'black':
      return seg.title || seg.id;
    case 'card':
      return seg.name || seg.id;
    case 'opener':
      return 'OP';
    case 'photo':
      return seg.file || baseName(seg.src) || seg.id;
    case 'photos':
      return seg.files?.[0] || seg.id;
    case 'ph':
      return seg.file || baseName(seg.src) || seg.id;
    case 'rt':
      return baseName(seg.src || seg.srcWin) || seg.id;
    default:
      return seg.id;
  }
}

function gainOf(seg: EdlSegment): number {
  return typeof seg.gainDb === 'number' && Number.isFinite(seg.gainDb) ? seg.gainDb : 0;
}

function intermediateAudible(seg: EdlSegment): boolean {
  if (seg.type === 'rt') return seg.hasAudio !== false;
  if (seg.type === 'ph' || seg.type === 'opener') return true;
  if (seg.type === 'hl' && seg.audio === 'real') return true;
  return false;
}

/** 付帯情報の dur と EDL の dur の許容差（秒） */
export const INTERMEDIATE_DUR_TOLERANCE = 0.05;

export type IntermediateCheck =
  | { status: 'none' }
  | { status: 'ok'; path: string; verified: boolean }
  | { status: 'mismatch'; path: string; reason: string };

function fmtSec(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : String(n);
}

/**
 * 中間ファイルの付帯情報 `<file>.json`（{hash, id, type, dur, from}）を EDL の区間と照合する。
 * 付帯情報が無ければ未検証として通す。読めない・型や長さが合わなければ使わない。
 */
export function checkIntermediateSidecar(
  seg: Pick<EdlSegment, 'id' | 'type' | 'dur'>,
  file: string,
  sidecarPaths: string[],
  exists: (p: string) => boolean,
  readText: ((p: string) => string | null) | undefined,
): IntermediateCheck {
  if (!readText) return { status: 'ok', path: file, verified: false };
  const sidecar = sidecarPaths.find((p) => exists(p));
  if (!sidecar) return { status: 'ok', path: file, verified: false };
  const text = readText(sidecar);
  let meta: unknown = null;
  if (text !== null) {
    try {
      meta = JSON.parse(text);
    } catch {
      meta = null;
    }
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { status: 'mismatch', path: file, reason: '中間ファイルの付帯情報が読めない' };
  }
  const m = meta as { type?: unknown; dur?: unknown };
  if (m.type !== seg.type) {
    return {
      status: 'mismatch',
      path: file,
      reason: `中間ファイルが EDL と合わない（種類 ${String(m.type)} / ${seg.type}）`,
    };
  }
  const dur = typeof m.dur === 'number' ? m.dur : Number.NaN;
  if (!Number.isFinite(dur) || Math.abs(dur - seg.dur) > INTERMEDIATE_DUR_TOLERANCE) {
    return {
      status: 'mismatch',
      path: file,
      reason: `中間ファイルが EDL と合わない（長さ ${fmtSec(dur)} / ${fmtSec(seg.dur)} 秒）`,
    };
  }
  return { status: 'ok', path: file, verified: true };
}

function resolveIntermediate(
  cacheResolved: string | null,
  seg: Pick<EdlSegment, 'id' | 'type' | 'dur'>,
  exists: (p: string) => boolean,
  readText: ((p: string) => string | null) | undefined,
): IntermediateCheck {
  if (!cacheResolved) return { status: 'none' };
  const full = joinEdlPath(cacheResolved, `${seg.id}.mp4`);
  if (exists(full)) {
    return checkIntermediateSidecar(seg, full, [`${full}.json`], exists, readText);
  }
  const proxy = joinEdlPath(cacheResolved, `${seg.id}.proxy.mp4`);
  if (exists(proxy)) {
    return checkIntermediateSidecar(seg, proxy, [`${proxy}.json`, `${full}.json`], exists, readText);
  }
  return { status: 'none' };
}

/** 解決できた静止画（HEIC は除外）。heicOnly は画像が HEIC だけで他に無い */
function resolveImages(
  seg: EdlSegment,
  opt: PathResolveOpts,
): { paths: string[]; heicOnly: boolean } {
  const groups: string[][] = [];
  if (seg.type === 'photo') {
    groups.push(orderedMediaCandidates(opt.platform, seg.src, seg.srcWin));
  } else {
    const srcs = seg.srcs ?? [];
    const wins = seg.srcWins ?? [];
    const n = Math.max(srcs.length, wins.length);
    for (let i = 0; i < n; i++) {
      groups.push(orderedMediaCandidates(opt.platform, srcs[i], wins[i]));
    }
  }
  const paths: string[] = [];
  let sawHeic = false;
  for (const cands of groups) {
    const resolved = resolveEdlPath(cands, opt);
    if (!resolved) continue;
    if (isHeic(resolved)) {
      sawHeic = true;
      continue;
    }
    paths.push(resolved);
  }
  return { paths, heicOnly: paths.length === 0 && sawHeic };
}

function resolveVideo(seg: EdlSegment, opt: PathResolveOpts): string | null {
  return resolveEdlPath(orderedMediaCandidates(opt.platform, seg.src, seg.srcWin), opt);
}

function videoFromIntermediate(seg: EdlSegment, url: string): EdlPlayback {
  return {
    kind: 'video',
    url,
    mediaStartSec: 0,
    timelineDur: seg.dur,
    playbackRate: 1,
    approximate: false,
    sourceSpeed: 1,
    audible: intermediateAudible(seg),
    gainDb: gainOf(seg),
    via: 'intermediate',
  };
}

function detailLines(seg: EdlSegment, extra: string[]): string {
  const lines = [`${seg.id}  ${seg.type}`];
  if (seg.chapter) lines.push(`章: ${seg.chapter}`);
  if (seg.a !== undefined) lines.push(`a–b: ${seg.a}–${seg.b ?? '?'}`);
  if (seg.speed !== undefined) lines.push(`速度: ×${seg.speed}`);
  if (seg.note) lines.push(`note: ${seg.note}`);
  for (const line of extra) {
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

function planSegment(
  seg: EdlSegment,
  ctx: PlanContext,
  cacheResolved: string | null,
): EdlSegmentPlan {
  const check = resolveIntermediate(cacheResolved, seg, ctx.exists, ctx.readText);
  const base = {
    id: seg.id,
    type: seg.type,
    start: seg.start,
    dur: seg.dur,
    chapter: seg.chapter,
    note: seg.note,
    label: labelOf(seg),
    ...(seg.speed !== undefined ? { speed: seg.speed } : {}),
  };

  if (check.status === 'ok') {
    const inter = check.path;
    return {
      ...base,
      detail: detailLines(seg, [
        check.verified ? `中間: ${inter}` : `中間: ${inter}（未検証: 付帯情報なし）`,
      ]),
      playback: videoFromIntermediate(seg, ctx.assetUrl('segment', seg.id)),
      realAudio: null,
    };
  }

  const plan = planFallback(seg, ctx, base);
  if (check.status !== 'mismatch') return plan;
  // 合わない中間ファイルは使わず、捨てた理由を見える所に出す
  const reason = check.reason;
  const detail = `${plan.detail}\n${reason}: ${check.path}`;
  const pb = plan.playback;
  if (pb.kind === 'video') {
    return { ...plan, detail, playback: { ...pb, notice: pb.notice ? `${reason} / ${pb.notice}` : reason } };
  }
  if (pb.kind === 'placeholder') {
    return { ...plan, detail, playback: { ...pb, reason: `${reason} / ${pb.reason}` } };
  }
  return { ...plan, detail };
}

type PlanBase = Pick<
  EdlSegmentPlan,
  'id' | 'type' | 'start' | 'dur' | 'chapter' | 'note' | 'label' | 'speed'
>;

/** 中間ファイルを使わないときの再生計画 */
function planFallback(seg: EdlSegment, ctx: PlanContext, base: PlanBase): EdlSegmentPlan {
  const opt = optsOf(ctx);
  const source = resolveVideo(seg, opt);
  const proxyUrl = source ? (ctx.findProxyUrl?.(source) ?? null) : null;

  const asSourceVideo = (
    url: string,
    via: 'source' | 'proxy',
    rate: number,
    speed: number,
    approximate: boolean,
    audible: boolean,
    notice?: string,
  ): EdlPlayback => ({
    kind: 'video',
    url,
    mediaStartSec: seg.a ?? 0,
    timelineDur: seg.dur,
    playbackRate: rate,
    approximate,
    sourceSpeed: speed,
    audible,
    gainDb: gainOf(seg),
    via,
    ...(notice ? { notice } : {}),
  });

  if (seg.type === 'rt' || seg.type === 'ph') {
    if (source) {
      const playback = asSourceVideo(
        proxyUrl ?? ctx.assetUrl('source', seg.id),
        proxyUrl ? 'proxy' : 'source',
        1,
        1,
        false,
        seg.type === 'ph' ? true : seg.hasAudio !== false,
      );
      return {
        ...base,
        detail: detailLines(seg, [proxyUrl ? `プロキシ: ${source}` : source]),
        playback,
        realAudio: null,
      };
    }
    const reason = seg.type === 'rt' ? 'RT: 素材が見つかりません' : 'PH: 素材が見つかりません';
    return {
      ...base,
      detail: detailLines(seg, [reason]),
      playback: { kind: 'placeholder', reason, timelineDur: seg.dur },
      realAudio: null,
    };
  }

  if (seg.type === 'hl') {
    const speed = seg.speed !== undefined && seg.speed >= 0.1 ? seg.speed : 1;
    if (source) {
      const approximate = speed > EDL_BROWSER_MAX_RATE + 1e-6;
      const notice = approximate
        ? `HL 近似 ×${speed}（ブラウザ最大 ×${EDL_BROWSER_MAX_RATE}）`
        : `HL ×${speed}（元素材）`;
      const audioPath = resolveEdlPath(
        orderedMediaCandidates(opt.platform, seg.audioSrc, seg.audioSrcWin),
        opt,
      );
      const realAudio =
        seg.audio === 'real' && audioPath
          ? { url: ctx.assetUrl('realaudio', seg.id), mediaStartSec: seg.audioA ?? 0 }
          : null;
      return {
        ...base,
        detail: detailLines(seg, [notice, source]),
        playback: asSourceVideo(
          proxyUrl ?? ctx.assetUrl('source', seg.id),
          proxyUrl ? 'proxy' : 'source',
          Math.min(speed, EDL_BROWSER_MAX_RATE),
          speed,
          approximate,
          false,
          notice,
        ),
        realAudio,
      };
    }
    const reason = 'HL: 中間ファイルなし';
    return {
      ...base,
      detail: detailLines(seg, [reason]),
      playback: { kind: 'placeholder', reason, timelineDur: seg.dur },
      realAudio: null,
    };
  }

  if (seg.type === 'photo' || seg.type === 'photos') {
    const images = resolveImages(seg, opt);
    if (images.paths.length > 0) {
      return {
        ...base,
        detail: detailLines(seg, images.paths),
        playback: {
          kind: 'image',
          urls: images.paths.map((_, i) => ctx.assetUrl('image', `${seg.id}:${i}`)),
          gapSec: seg.gap ?? null,
          ...(seg.zoom !== undefined ? { zoom: seg.zoom } : {}),
          ...(seg.fit !== undefined ? { fit: seg.fit } : {}),
          timelineDur: seg.dur,
        },
        realAudio: null,
      };
    }
    const reason = images.heicOnly ? 'HEIC はブラウザで表示できません' : '画像が見つかりません';
    return {
      ...base,
      detail: detailLines(seg, [reason]),
      playback: { kind: 'placeholder', reason, timelineDur: seg.dur },
      realAudio: null,
    };
  }

  if (seg.type === 'black') {
    const title = seg.title || seg.chapter || 'black';
    const sub = seg.sub ?? '';
    return {
      ...base,
      detail: detailLines(seg, [title, sub]),
      playback: { kind: 'card', title, sub, timelineDur: seg.dur },
      realAudio: null,
    };
  }

  if (seg.type === 'card' || seg.type === 'opener') {
    if (source) {
      return {
        ...base,
        detail: detailLines(seg, [source]),
        playback: asSourceVideo(
          proxyUrl ?? ctx.assetUrl('source', seg.id),
          proxyUrl ? 'proxy' : 'source',
          1,
          1,
          false,
          seg.type === 'opener',
        ),
        realAudio: null,
      };
    }
    const reason =
      seg.type === 'card' ? 'カード: 素材が見つかりません' : 'オープナー: 素材が見つかりません';
    return {
      ...base,
      detail: detailLines(seg, [reason]),
      playback: { kind: 'placeholder', reason, timelineDur: seg.dur },
      realAudio: null,
    };
  }

  const reason = `未対応の区間タイプ: ${seg.type}`;
  return {
    ...base,
    detail: detailLines(seg, [reason]),
    playback: { kind: 'placeholder', reason, timelineDur: seg.dur },
    realAudio: null,
  };
}

function planMusic(m: EdlMusic, ctx: PlanContext): EdlMusicPlan {
  const opt = optsOf(ctx);
  const cands: string[] = [];
  if (m.trackPath) cands.push(m.trackPath);
  if (m.file && isAbsoluteLike(m.file)) cands.push(m.file);
  const resolved = resolveEdlPath(cands, opt);
  const plan: EdlMusicPlan = {
    id: m.id,
    cue: m.cue,
    start: m.start,
    end: m.end,
    dur: m.dur,
    trackIn: m.trackIn,
    gainDb: m.gainDb,
    fadeIn: m.fadeIn,
    fadeOut: m.fadeOut,
    duck: m.duck,
    url: resolved ? ctx.assetUrl('music', m.id) : null,
  };
  if (!resolved) plan.missingReason = '音楽: ファイルが見つかりません';
  return plan;
}

export function buildTimeline(doc: EdlDocument, ctx: PlanContext): EdlTimeline {
  const opt = optsOf(ctx);
  const configured = ctx.cacheDir.trim();
  const resolved = configured ? resolveEdlPath([configured], opt) : null;
  return {
    sourceId: ctx.sourceId,
    title: doc.title,
    fps: doc.fps,
    width: doc.width,
    height: doc.height,
    durationSec: doc.durationSec,
    chapters: doc.chapters,
    segments: doc.segments.map((s) => planSegment(s, ctx, resolved)),
    music: doc.music.map((m) => planMusic(m, ctx)),
    subtitles: doc.subtitles,
    xposts: doc.xposts,
    cache: { configured, resolved },
    resolvedOn: ctx.platform === 'win32' ? 'win32' : 'posix',
  };
}

function splitImageKey(key: string): { id: string; index: number } | null {
  const i = key.lastIndexOf(':');
  if (i <= 0) return null;
  const id = key.slice(0, i);
  const index = Number(key.slice(i + 1));
  if (!id || !Number.isInteger(index) || index < 0) return null;
  return { id, index };
}

/**
 * role+key から配信してよい絶対パスだけを返す。
 * key をパスとして解釈しない。
 */
export function resolveAssetFile(
  doc: EdlDocument,
  cacheDir: string,
  role: string,
  key: string,
  opt: PathResolveOpts,
  readText?: (p: string) => string | null,
): string | null {
  const cacheResolved = cacheDir.trim() ? resolveEdlPath([cacheDir], opt) : null;

  if (role === 'segment') {
    const seg = doc.segments.find((s) => s.id === key);
    if (!seg) return null;
    const check = resolveIntermediate(cacheResolved, seg, opt.exists, readText);
    return check.status === 'ok' ? check.path : null;
  }

  if (role === 'source' || role === 'realaudio') {
    const seg = doc.segments.find((s) => s.id === key);
    if (!seg) return null;
    if (role === 'realaudio') {
      if (seg.audio !== 'real') return null;
      return resolveEdlPath(orderedMediaCandidates(opt.platform, seg.audioSrc, seg.audioSrcWin), opt);
    }
    if (seg.type === 'photo' || seg.type === 'photos' || seg.type === 'black') return null;
    return resolveVideo(seg, opt);
  }

  if (role === 'image') {
    const parsed = splitImageKey(key);
    if (!parsed) return null;
    const seg = doc.segments.find((s) => s.id === parsed.id);
    if (!seg || (seg.type !== 'photo' && seg.type !== 'photos')) return null;
    const images = resolveImages(seg, opt);
    return images.paths[parsed.index] ?? null;
  }

  if (role === 'music') {
    const m = doc.music.find((x) => x.id === key);
    if (!m) return null;
    const cands: string[] = [];
    if (m.trackPath) cands.push(m.trackPath);
    if (m.file && isAbsoluteLike(m.file)) cands.push(m.file);
    return resolveEdlPath(cands, opt);
  }

  return null;
}
