import fsp from 'node:fs/promises';
import type {
  EdlChapter,
  EdlDocument,
  EdlMusic,
  EdlSegment,
  EdlSubtitle,
  EdlXPost,
} from '@veh/shared';

export type ParseEdlResult = { ok: true; doc: EdlDocument } | { ok: false; error: string };

const MAX_BYTES = 20 * 1024 * 1024;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function strList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

function parseSegment(raw: unknown): EdlSegment | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const type = str(raw.type);
  const start = num(raw.start);
  const dur = num(raw.dur);
  if (!id || !type || start === null || dur === null || dur <= 0) return null;
  const seg: EdlSegment = {
    id,
    type,
    start,
    dur,
    chapter: str(raw.chapter) ?? '',
    note: str(raw.note) ?? '',
  };
  const title = str(raw.title);
  const sub = str(raw.sub);
  const name = str(raw.name);
  const src = str(raw.src);
  const srcWin = str(raw.srcWin);
  const a = num(raw.a);
  const b = num(raw.b);
  const speed = num(raw.speed);
  const gainDb = num(raw.gainDb);
  const audio = str(raw.audio);
  const audioSrc = str(raw.audioSrc);
  const audioSrcWin = str(raw.audioSrcWin);
  const audioA = num(raw.audioA);
  const file = str(raw.file);
  const zoom = str(raw.zoom);
  const fit = str(raw.fit);
  const gap = num(raw.gap);
  if (title !== undefined) seg.title = title;
  if (sub !== undefined) seg.sub = sub;
  if (name !== undefined) seg.name = name;
  if (src !== undefined) seg.src = src;
  if (srcWin !== undefined) seg.srcWin = srcWin;
  if (a !== null) seg.a = a;
  if (b !== null) seg.b = b;
  if (speed !== null) seg.speed = speed;
  if (gainDb !== null) seg.gainDb = gainDb;
  if (typeof raw.hasAudio === 'boolean') seg.hasAudio = raw.hasAudio;
  if (audio !== undefined) seg.audio = audio;
  if (audioSrc !== undefined) seg.audioSrc = audioSrc;
  if (audioSrcWin !== undefined) seg.audioSrcWin = audioSrcWin;
  if (audioA !== null) seg.audioA = audioA;
  if (file !== undefined) seg.file = file;
  const files = strList(raw.files);
  const srcs = strList(raw.srcs);
  const srcWins = strList(raw.srcWins);
  if (files) seg.files = files;
  if (srcs) seg.srcs = srcs;
  if (srcWins) seg.srcWins = srcWins;
  if (zoom !== undefined) seg.zoom = zoom;
  if (fit !== undefined) seg.fit = fit;
  if (gap !== null) seg.gap = gap;
  return seg;
}

function parseMusic(raw: unknown): EdlMusic | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const start = num(raw.start);
  const end = num(raw.end);
  if (!id || start === null || end === null || end <= start) return null;
  const file = str(raw.file) ?? '';
  const cue = str(raw.cue) ?? (file || id);
  const dur = num(raw.dur) ?? end - start;
  return {
    id,
    file,
    cue,
    start,
    end,
    dur,
    trackIn: num(raw.trackIn) ?? 0,
    gainDb: num(raw.gainDb) ?? 0,
    fadeIn: num(raw.fadeIn) ?? 0,
    fadeOut: num(raw.fadeOut) ?? 0,
    duck: raw.duck === true,
    ...(str(raw.trackPath) !== undefined ? { trackPath: str(raw.trackPath) } : {}),
  };
}

function parseSubtitle(raw: unknown): EdlSubtitle | null {
  if (!isObj(raw)) return null;
  const start = num(raw.start);
  const end = num(raw.end);
  const text = str(raw.text)?.trim() ?? '';
  if (start === null || end === null || end <= start || !text) return null;
  return { start, end, style: str(raw.style) ?? '', text };
}

function parseXPost(raw: unknown): EdlXPost | null {
  if (!isObj(raw)) return null;
  const start = num(raw.start);
  const end = num(raw.end);
  const text = str(raw.text) ?? '';
  if (start === null || end === null || end <= start || !text.trim()) return null;
  const post: EdlXPost = {
    start,
    end,
    text,
    pos: str(raw.pos) ?? 'corner',
  };
  const id = str(raw.id);
  const time = str(raw.time);
  if (id) post.id = id;
  if (time) post.time = time;
  return post;
}

function parseChapter(raw: unknown): EdlChapter | null {
  if (!isObj(raw)) return null;
  const title = str(raw.title);
  const start = num(raw.start);
  if (!title || start === null) return null;
  return { title, start };
}

/** 未知フィールドは捨てる。区間が 1 つも無ければエラー */
export function parseEdl(input: unknown): ParseEdlResult {
  if (!isObj(input)) return { ok: false, error: 'EDL がオブジェクトではありません' };
  if (!Array.isArray(input.segments)) return { ok: false, error: 'EDL に segments がありません' };

  const segments = input.segments
    .map(parseSegment)
    .filter((s): s is EdlSegment => s !== null)
    .sort((a, b) => a.start - b.start);
  if (segments.length === 0) return { ok: false, error: '有効な区間がありません' };

  const last = segments[segments.length - 1]!;
  const declared = num(input.durationSec);
  const durationSec = declared !== null && declared > 0 ? declared : last.start + last.dur;

  const chapters = (Array.isArray(input.chapters) ? input.chapters : [])
    .map(parseChapter)
    .filter((c): c is EdlChapter => c !== null)
    .sort((a, b) => a.start - b.start);

  const music = (Array.isArray(input.music) ? input.music : [])
    .map(parseMusic)
    .filter((m): m is EdlMusic => m !== null)
    .sort((a, b) => a.start - b.start);

  const subtitles = (Array.isArray(input.subtitles) ? input.subtitles : [])
    .map(parseSubtitle)
    .filter((s): s is EdlSubtitle => s !== null)
    .sort((a, b) => a.start - b.start);

  const xposts = (Array.isArray(input.xposts) ? input.xposts : [])
    .map(parseXPost)
    .filter((x): x is EdlXPost => x !== null)
    .sort((a, b) => a.start - b.start);

  const fps = num(input.fps);
  const width = num(input.width);
  const height = num(input.height);

  return {
    ok: true,
    doc: {
      title: str(input.title)?.trim() || 'EDL',
      fps: fps !== null && fps > 0 ? fps : 30,
      width: width !== null && width > 0 ? width : 1280,
      height: height !== null && height > 0 ? height : 720,
      durationSec,
      chapters,
      segments,
      music,
      subtitles,
      xposts,
    },
  };
}

/** パスは呼び出し側で解決済みであること。20MB を超えるファイルは拒否する */
export async function readEdlFile(filePath: string): Promise<ParseEdlResult> {
  let size: number;
  try {
    const stat = await fsp.stat(filePath);
    size = stat.size;
  } catch {
    return { ok: false, error: 'EDL ファイルが見つかりません' };
  }
  if (size > MAX_BYTES) return { ok: false, error: 'EDL が大きすぎます（20MB 超）' };
  let text: string;
  try {
    text = await fsp.readFile(filePath, 'utf8');
  } catch {
    return { ok: false, error: 'EDL を読み取れません' };
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, error: 'EDL が JSON として読めません' };
  }
  return parseEdl(json);
}
