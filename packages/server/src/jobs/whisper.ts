import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  locateInFiles,
  type Clip,
  type FileSpan,
  type TimeRange,
  type Transcript,
  type TranscriptSegment,
} from '@veh/shared';
import type { Config } from '../config.js';
import type { VadProvider } from '../vad/silencedetect.js';
import { readVadResult, runVadForClip } from './vad.js';
import { buildSpeechBlocks } from '../transcribe/blocks.js';
import { parseWhisperJson } from '../transcribe/whisperJson.js';
import { assembleSegments, type BlockResult } from '../transcribe/assemble.js';

/** 文字起こし結果 JSON のパス */
export function transcriptPath(config: Config, clipId: string): string {
  return path.join(config.transcriptsDir, `${clipId}.json`);
}

/** 既に文字起こし結果が存在するか */
export function hasTranscript(config: Config, clipId: string): boolean {
  return fs.existsSync(transcriptPath(config, clipId));
}

/** 保存済み文字起こし結果を読む(無ければ null) */
export async function readTranscript(config: Config, clipId: string): Promise<Transcript | null> {
  try {
    const raw = await fsp.readFile(transcriptPath(config, clipId), 'utf8');
    return JSON.parse(raw) as Transcript;
  } catch {
    return null;
  }
}

/**
 * whisper プロセスをモジュール全体で直列化する Promise ミューテックス。
 * CPU 飽和を防ぐため、同時に動く whisper-cli は常に 1 つに制限する。
 * (queue 自体の並列度には手を付けない)
 */
let whisperLock: Promise<void> = Promise.resolve();
function withWhisperLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = whisperLock.then(fn, fn);
  // 失敗しても次の待機者がデッドロックしないよう、解決済みチェーンに繋ぐ
  whisperLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** クリップの VAD segments を取得(無ければその場で実行) */
async function ensureVadSegments(
  config: Config,
  provider: VadProvider,
  clip: Clip,
): Promise<TimeRange[]> {
  const existing = await readVadResult(config, clip.id);
  if (existing) return existing.segments;
  const result = await runVadForClip(config, provider, clip);
  return result.segments;
}

/** ブロック [start,end](クリップ通しタイムコード)を 16kHz mono wav に抽出 */
function extractBlockWav(
  ffmpegPath: string,
  clip: Clip,
  block: TimeRange,
  outPath: string,
): Promise<void> {
  const spans: FileSpan[] = clip.files.map((f) => ({
    id: f.id,
    startOffsetSec: f.startOffsetSec,
    durationSec: f.durationSec,
  }));
  // ブロックは原則 1 ファイル内に収まるが、境界跨ぎなら起点ファイルから抽出する。
  // (whisper はブロック単位なので 1 起点ファイルからの抽出で実用上十分)
  const loc = locateInFiles(spans, block.start);
  const file = clip.files[loc.index]!;
  const offsetSec = loc.offsetSec;
  const durSec = Math.max(0.05, block.end - block.start);
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-ss',
      String(offsetSec),
      '-t',
      String(durSec),
      '-i',
      file.path,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-y',
      outPath,
    ];
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg(wav) failed (${code}): ${stderr.trim()}`));
    });
  });
}

/** whisper-cli を実行して JSON を出力(<tmpbase>.json)。直列化はしない(呼び出し側で) */
function runWhisperCli(
  config: Config,
  wavPath: string,
  outBase: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-m',
      config.whisperModelPath,
      '-f',
      wavPath,
      // 言語指定('auto' で自動判定。VEH_WHISPER_LANG=ja 等で固定可能)
      '-l',
      config.whisperLanguage,
      '-t',
      String(config.whisperThreads),
      '-oj',
      '-of',
      outBase,
      '-np',
    ];
    const proc = spawn(config.whisperPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`whisper-cli failed (${code}): ${stderr.trim().slice(-500)}`));
    });
  });
}

/** モデルファイル名(拡張子なし)をモデル識別子に使う。例: ggml-small.bin → ggml-small */
function modelName(modelPath: string): string {
  const base = path.basename(modelPath);
  return base.replace(/\.[^.]+$/, '');
}

export interface TranscribeOptions {
  onProgress?: (ratio: number) => void;
  onMessage?: (message: string) => void;
}

/**
 * クリップを文字起こしして cache/transcripts/<clipId>.json に保存する。
 * 1) VAD segments を取得(無ければその場で実行)
 * 2) 発話ブロック化
 * 3) ブロックごとに wav 抽出 → whisper-cli(直列化)→ JSON パース
 * 4) ブロック開始時刻でオフセットして通しタイムコード化
 * segments が空なら空 Transcript を保存して正常終了する。
 */
export async function transcribeClip(
  config: Config,
  provider: VadProvider,
  clip: Clip,
  opts: TranscribeOptions = {},
): Promise<Transcript> {
  const { onProgress, onMessage } = opts;
  await fsp.mkdir(config.transcriptsDir, { recursive: true });

  onMessage?.('vad 確認中');
  const segments = await ensureVadSegments(config, provider, clip);
  const blocks = buildSpeechBlocks(segments, clip.durationSec);

  const model = modelName(config.whisperModelPath);

  if (blocks.length === 0) {
    const empty: Transcript = {
      clipId: clip.id,
      model,
      segments: [],
      generatedAt: new Date().toISOString(),
    };
    await fsp.writeFile(transcriptPath(config, clip.id), JSON.stringify(empty), 'utf8');
    onProgress?.(1);
    return empty;
  }

  const blockResults: BlockResult[] = [];
  const total = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    onMessage?.(`whisper ${i + 1}/${total}`);
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'veh-whisper-'));
    const wavPath = path.join(tmpDir, 'block.wav');
    const outBase = path.join(tmpDir, 'block');
    try {
      await extractBlockWav(config.ffmpegPath, clip, block, wavPath);
      // whisper プロセスはモジュール全体で 1 つに直列化
      await withWhisperLock(() => runWhisperCli(config, wavPath, outBase));
      let parsed: { startSec: number; endSec: number; text: string }[] = [];
      try {
        const jsonText = await fsp.readFile(`${outBase}.json`, 'utf8');
        parsed = parseWhisperJson(jsonText);
      } catch {
        // JSON が出力されなかった(無音等)→ このブロックは空扱い
        parsed = [];
      }
      blockResults.push({ blockStartSec: block.start, segments: parsed });
    } finally {
      // 一時ファイルは必ず片付ける
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
    onProgress?.((i + 1) / total);
  }

  const finalSegments: TranscriptSegment[] = assembleSegments(blockResults);
  const transcript: Transcript = {
    clipId: clip.id,
    model,
    segments: finalSegments,
    generatedAt: new Date().toISOString(),
  };
  await fsp.writeFile(transcriptPath(config, clip.id), JSON.stringify(transcript), 'utf8');
  onProgress?.(1);
  return transcript;
}
