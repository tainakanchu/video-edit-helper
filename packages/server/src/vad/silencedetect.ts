import { spawn } from 'node:child_process';
import { normalizeRanges, type TimeRange } from '@veh/shared';

/** VAD プロバイダ共通インターフェース */
export interface VadProvider {
  name: 'silero' | 'silencedetect';
  /** ファイルローカル秒で発話区間を返す */
  detectFile(
    filePath: string,
    durationSec: number,
    onProgress?: (ratio: number) => void,
  ): Promise<TimeRange[]>;
}

/**
 * ffmpeg silencedetect の stderr から無音区間をパースし、
 * 「無音でない区間」= 発話区間に反転する純関数。
 * durationSec はクリップ末尾まで反転するために使う。
 */
export function parseSilenceDetect(stderr: string, durationSec: number): TimeRange[] {
  const silences: TimeRange[] = [];
  let pendingStart: number | null = null;

  const startRe = /silence_start:\s*(-?[\d.]+)/;
  const endRe = /silence_end:\s*(-?[\d.]+)/;

  for (const line of stderr.split('\n')) {
    const sm = line.match(startRe);
    if (sm) {
      pendingStart = Number(sm[1]);
      continue;
    }
    const em = line.match(endRe);
    if (em) {
      const end = Number(em[1]);
      const start = pendingStart ?? 0;
      silences.push({ start: Math.max(0, start), end });
      pendingStart = null;
    }
  }
  // 末尾が無音で終わる(silence_end が無い)場合は durationSec まで
  if (pendingStart !== null && durationSec > pendingStart) {
    silences.push({ start: Math.max(0, pendingStart), end: durationSec });
  }

  const normSilences = normalizeRanges(silences, 0);

  // 無音の補集合 = 発話区間
  const speech: TimeRange[] = [];
  let cursor = 0;
  for (const s of normSilences) {
    if (s.start > cursor) {
      speech.push({ start: cursor, end: Math.min(s.start, durationSec) });
    }
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < durationSec) {
    speech.push({ start: cursor, end: durationSec });
  }
  return normalizeRanges(speech, 0);
}

/** silencedetect ベースのフォールバック VAD プロバイダ */
export class SilenceDetectProvider implements VadProvider {
  readonly name = 'silencedetect' as const;
  constructor(private readonly ffmpegPath = 'ffmpeg') {}

  detectFile(filePath: string, durationSec: number): Promise<TimeRange[]> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        filePath,
        '-af',
        'silencedetect=noise=-30dB:d=0.8',
        '-f',
        'null',
        '-',
      ];
      const proc = spawn(this.ffmpegPath, args);
      let stderr = '';
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`silencedetect failed (${code})`));
          return;
        }
        resolve(parseSilenceDetect(stderr, durationSec));
      });
    });
  }
}
