import fs from 'node:fs';
import path from 'node:path';

/** 拡張子から Content-Type を決定 */
export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  return 'application/octet-stream';
}

export interface ParsedRange {
  start: number;
  end: number;
}

/**
 * Range ヘッダ('bytes=START-END')をパース。
 * 不正(範囲外・解釈不能)なら null(呼び出し側で 416)。
 * Range ヘッダ自体が無い場合も null(全体配信)。
 */
export function parseRange(rangeHeader: string | undefined, size: number): ParsedRange | null {
  if (!rangeHeader) return null;
  const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === '' && endRaw === '') return null;

  let start: number;
  let end: number;
  if (startRaw === '') {
    // 末尾 N バイト(suffix-range)
    const suffix = Number(endRaw);
    if (suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw === '' ? size - 1 : Number(endRaw);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size || end >= size) return null;
  return { start, end };
}

/** メディアファイル配信の結果(Fastify ハンドラが利用) */
export interface MediaResponse {
  statusCode: number;
  headers: Record<string, string>;
  stream?: fs.ReadStream;
  /** 416 等で本文不要の場合 */
  body?: string;
}

/**
 * 解決済みファイルパスと Range ヘッダから配信レスポンスを構築する。
 * 存在しない場合は呼び出し側が 404 を返す前提(ここでは stat 済み size を渡す)。
 */
export function buildMediaResponse(
  filePath: string,
  size: number,
  rangeHeader: string | undefined,
): MediaResponse {
  const contentType = contentTypeFor(filePath);

  // Range ヘッダがあるがパース不能 → 416
  if (rangeHeader) {
    const parsed = parseRange(rangeHeader, size);
    if (parsed === null) {
      return {
        statusCode: 416,
        headers: {
          'Content-Range': `bytes */${size}`,
          'Accept-Ranges': 'bytes',
        },
        body: 'Range Not Satisfiable',
      };
    }
    const length = parsed.end - parsed.start + 1;
    return {
      statusCode: 206,
      headers: {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(length),
      },
      stream: fs.createReadStream(filePath, { start: parsed.start, end: parsed.end }),
    };
  }

  // Range なし → 200 全体
  return {
    statusCode: 200,
    headers: {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size),
    },
    stream: fs.createReadStream(filePath),
  };
}
