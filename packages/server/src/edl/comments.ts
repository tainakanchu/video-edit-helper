import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { EdlComment, EdlCommentsFile } from '@veh/shared';

/** `ep01.json` → 同じディレクトリの `ep01.comments.json` */
export function commentsPathFor(edlPath: string): string {
  const trimmed = edlPath.trim();
  const norm = trimmed.replaceAll('\\', '/');
  const slash = norm.lastIndexOf('/');
  const dir = slash >= 0 ? norm.slice(0, slash) : '';
  const base = slash >= 0 ? norm.slice(slash + 1) : norm;
  const stem = base.toLowerCase().endsWith('.json') ? base.slice(0, -5) : base;
  const file = `${stem}.comments.json`;
  if (!dir) return file;
  if (trimmed.includes('\\')) return `${dir.replaceAll('/', '\\')}\\${file}`;
  return `${dir}/${file}`;
}

function isComment(v: unknown): v is EdlComment {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.segmentId === 'string' &&
    typeof o.timeSec === 'number' &&
    Number.isFinite(o.timeSec) &&
    typeof o.text === 'string' &&
    typeof o.createdAt === 'string'
  );
}

export function readComments(edlPath: string): EdlComment[] {
  const file = commentsPathFor(edlPath);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<EdlCommentsFile>;
    if (!raw || !Array.isArray(raw.comments)) return [];
    return raw.comments.filter(isComment);
  } catch (err) {
    console.warn(`[edl] comments を読めません: ${String(err)}`);
    return [];
  }
}

function writeComments(edlPath: string, comments: EdlComment[]): void {
  const file = commentsPathFor(edlPath);
  const body: EdlCommentsFile = { version: 1, comments };
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(body, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function addComment(
  edlPath: string,
  input: { segmentId: string; timeSec: number; text: string },
): EdlComment {
  const text = input.text.trim();
  if (!text) throw new Error('コメントが空です');
  if (!Number.isFinite(input.timeSec) || input.timeSec < 0) throw new Error('時刻が不正です');
  if (!input.segmentId.trim()) throw new Error('区間が指定されていません');
  const comment: EdlComment = {
    id: nanoid(12),
    segmentId: input.segmentId,
    timeSec: input.timeSec,
    text,
    createdAt: new Date().toISOString(),
  };
  const comments = readComments(edlPath);
  comments.push(comment);
  writeComments(edlPath, comments);
  return comment;
}

export function deleteComment(edlPath: string, commentId: string): boolean {
  const comments = readComments(edlPath);
  const next = comments.filter((c) => c.id !== commentId);
  if (next.length === comments.length) return false;
  writeComments(edlPath, next);
  return true;
}

/** テストで tmp を消すとき用。本体はコメントファイル以外を消さない */
export async function removeCommentsFile(edlPath: string): Promise<void> {
  await fsp.rm(commentsPathFor(edlPath), { force: true });
}
