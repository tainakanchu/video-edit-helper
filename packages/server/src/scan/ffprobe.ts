import { spawn } from 'node:child_process';
import type { GpsPoint } from '@veh/shared';

/** ffprobe で抽出したメタデータ(grouping より前段の生情報) */
export interface ProbeMetadata {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  fps: number | null;
  /** ISO 文字列。無ければ null */
  createdAt: string | null;
  playableInBrowser: boolean;
  /** 撮影位置(location タグ ISO6709)。無ければ null */
  gps: GpsPoint | null;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
  tags?: Record<string, string>;
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** '30000/1001' 形式の分数表記を数値 fps に変換 */
export function parseFrameRate(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/^(\d+)\/(\d+)$/);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (den === 0) return null;
    return num / den;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** creation_time を ISO に正規化(パース不能なら null) */
function normalizeCreationTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * ISO6709 文字列(コンテナの location タグ)を GpsPoint にパースする純関数。
 * 例: '+35.0421+135.7556/' (2D)
 *     '+35.0421+135.7556+22.9/' (高度付き 3D)
 *     '+35.0421+135.7556+022.900CRSWGS_84/' (CRS 付き)
 * 緯度・経度の符号付き数値を先頭から 2 つ取り、範囲チェック後に返す。
 * パース不能・範囲外なら null。
 */
export function parseIso6709(s: string | undefined | null): GpsPoint | null {
  if (!s) return null;
  // 符号(+/-)で始まる数値トークンを先頭から拾う。CRS 名や末尾 '/' は無視される。
  const matches = s.match(/[+-]\d+(?:\.\d+)?/g);
  if (!matches || matches.length < 2) return null;
  const lat = Number(matches[0]);
  const lon = Number(matches[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** format.tags から location / location-eng を取り出して GpsPoint にする */
function extractGps(tags: Record<string, string> | undefined): GpsPoint | null {
  if (!tags) return null;
  const raw = tags.location ?? tags['location-eng'];
  return parseIso6709(raw);
}

/** ffprobe JSON から ProbeMetadata を抽出する純関数 */
export function parseProbeJson(json: FfprobeJson): ProbeMetadata {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');

  let durationSec = 0;
  if (json.format?.duration) {
    durationSec = Number(json.format.duration);
  }
  if ((!durationSec || !Number.isFinite(durationSec)) && video?.duration) {
    durationSec = Number(video.duration);
  }
  if (!Number.isFinite(durationSec)) durationSec = 0;

  const videoCodec = video?.codec_name ?? '';
  const audioCodec = audio?.codec_name ?? null;
  const playableInBrowser =
    videoCodec === 'h264' && (audioCodec === null || audioCodec === 'aac' || audioCodec === 'mp3');

  return {
    durationSec,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    videoCodec,
    audioCodec,
    fps: parseFrameRate(video?.avg_frame_rate),
    createdAt: normalizeCreationTime(json.format?.tags?.creation_time),
    playableInBrowser,
    gps: extractGps(json.format?.tags),
  };
}

/** ffprobe を spawn してメタデータを取得 */
export function ffprobe(filePath: string, ffprobePath = 'ffprobe'): Promise<ProbeMetadata> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];
    const proc = spawn(ffprobePath, args);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed (${code}): ${stderr.trim()}`));
        return;
      }
      try {
        const json = JSON.parse(stdout) as FfprobeJson;
        resolve(parseProbeJson(json));
      } catch (e) {
        reject(new Error(`ffprobe JSON parse error: ${(e as Error).message}`));
      }
    });
  });
}
