import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { normalizeRanges, type TimeRange } from '@veh/shared';
import type { VadProvider } from './silencedetect.js';

const SAMPLE_RATE = 16000;
const WINDOW = 512; // 推論窓サンプル数(16kHz)
const CONTEXT = 64; // v5: 前窓末尾から引き継ぐコンテキストサンプル数
const SPEECH_THRESHOLD = 0.5; // 発話開始
const SILENCE_THRESHOLD = 0.35; // 発話終了(ヒステリシス下限)
const MIN_SILENCE_SEC = 0.6; // 終了確定までの無音継続時間
const PAD_SEC = 0.15; // 前後パディング
const MIN_SPEECH_SEC = 0.25; // これ未満の区間は破棄

/**
 * prob 列(各窓 = WINDOW/SAMPLE_RATE 秒)からヒステリシスで発話区間を抽出する純関数。
 * テスト可能なように切り出している。
 */
export function probsToSegments(probs: number[], windowSec: number): TimeRange[] {
  const segments: TimeRange[] = [];
  let inSpeech = false;
  let segStart = 0;
  let silenceRun = 0; // 終了候補の連続無音秒数
  let lastSpeechEnd = 0;

  for (let i = 0; i < probs.length; i++) {
    const t = i * windowSec;
    const prob = probs[i]!;
    if (!inSpeech) {
      if (prob >= SPEECH_THRESHOLD) {
        inSpeech = true;
        segStart = t;
        silenceRun = 0;
        lastSpeechEnd = t + windowSec;
      }
    } else {
      if (prob < SILENCE_THRESHOLD) {
        silenceRun += windowSec;
        if (silenceRun >= MIN_SILENCE_SEC) {
          // 発話終了確定(末尾の無音は含めない)
          segments.push({ start: segStart, end: lastSpeechEnd });
          inSpeech = false;
          silenceRun = 0;
        }
      } else {
        silenceRun = 0;
        lastSpeechEnd = t + windowSec;
      }
    }
  }
  if (inSpeech) {
    segments.push({ start: segStart, end: lastSpeechEnd });
  }

  // 前後パディング → 短すぎる区間破棄 → 正規化
  const padded = segments
    .map((s) => ({ start: Math.max(0, s.start - PAD_SEC), end: s.end + PAD_SEC }))
    .filter((s) => s.end - s.start >= MIN_SPEECH_SEC);
  return normalizeRanges(padded, 0);
}

type Ort = typeof import('onnxruntime-node');

/** Silero VAD(ONNX)プロバイダ。利用不可ならコンストラクタが例外を投げる */
export class SileroProvider implements VadProvider {
  readonly name = 'silero' as const;
  private constructor(
    private readonly ort: Ort,
    private readonly session: import('onnxruntime-node').InferenceSession,
    private readonly version: 'v4' | 'v5',
    private readonly ffmpegPath: string,
  ) {}

  /** モデルをロードしてプロバイダを生成。失敗時は例外で不可を通知 */
  static async create(modelPath: string, ffmpegPath = 'ffmpeg'): Promise<SileroProvider> {
    if (!fs.existsSync(modelPath)) {
      throw new Error(`silero model not found: ${modelPath}`);
    }
    const ort = await import('onnxruntime-node');
    const session = await ort.InferenceSession.create(modelPath);
    const inputs = session.inputNames;
    // v5: state を 1 つ持つ / v4: h,c を持つ
    const version: 'v4' | 'v5' = inputs.includes('state') ? 'v5' : 'v4';
    return new SileroProvider(ort, session, version, ffmpegPath);
  }

  async detectFile(
    filePath: string,
    durationSec: number,
    onProgress?: (ratio: number) => void,
  ): Promise<TimeRange[]> {
    const probs = await this.inferProbs(filePath, durationSec, onProgress);
    // 末尾ゼロ埋め窓やパディングでファイル長を超えないようクランプ
    return probsToSegments(probs, WINDOW / SAMPLE_RATE)
      .map((s) => ({ start: s.start, end: Math.min(s.end, durationSec) }))
      .filter((s) => s.end > s.start);
  }

  /** ffmpeg で f32le PCM を取り出し、512 サンプル窓ごとに推論して prob 列を返す */
  private inferProbs(
    filePath: string,
    durationSec: number,
    onProgress?: (ratio: number) => void,
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      const args = [
        '-v',
        'error',
        '-i',
        filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        'f32le',
        'pipe:1',
      ];
      const proc = spawn(this.ffmpegPath, args);
      const probs: number[] = [];

      // 状態(v5: state / v4: h,c)。v5 は前窓末尾 64 サンプルのコンテキストも引き継ぐ
      let state = this.zeros([2, 1, 128]);
      let h = this.zeros([2, 1, 64]);
      let c = this.zeros([2, 1, 64]);
      let context = new Float32Array(CONTEXT); // v5 用(初回はゼロ)
      const srTensor = new this.ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), [1]);

      let leftover = Buffer.alloc(0);
      let pending = new Float32Array(0); // 窓に満たないサンプルの繰り越し
      let processedSamples = 0;
      const totalSamples = Math.max(1, Math.floor(durationSec * SAMPLE_RATE));

      const runWindow = async (window: Float32Array): Promise<void> => {
        if (this.version === 'v5') {
          // v5 の入力は [1, CONTEXT + WINDOW]。先頭に前窓末尾のコンテキストを連結する
          const inputData = new Float32Array(CONTEXT + WINDOW);
          inputData.set(context);
          inputData.set(window, CONTEXT);
          const input = new this.ort.Tensor('float32', inputData, [1, CONTEXT + WINDOW]);
          const out = await this.session.run({ input, state, sr: srTensor });
          const prob = (out.output ?? out.prob)!.data as Float32Array;
          probs.push(prob[0]!);
          state = (out.stateN ?? out.state)!;
          context = inputData.slice(inputData.length - CONTEXT);
        } else {
          const input = new this.ort.Tensor('float32', Float32Array.from(window), [1, WINDOW]);
          const out = await this.session.run({ input, sr: srTensor, h, c });
          const prob = (out.output ?? out.prob)!.data as Float32Array;
          probs.push(prob[0]!);
          h = out.hn!;
          c = out.cn!;
        }
        processedSamples += WINDOW;
      };

      // ストリーム処理は逐次 await が必要なため Promise チェーンで直列化
      let chain: Promise<void> = Promise.resolve();
      let chainError: Error | null = null;

      const processFloats = async (incoming: Float32Array): Promise<void> => {
        // 前回の端数と連結してから 512 サンプル窓を切り出す(取りこぼし防止)
        let floats: Float32Array;
        if (pending.length > 0) {
          floats = new Float32Array(pending.length + incoming.length);
          floats.set(pending);
          floats.set(incoming, pending.length);
        } else {
          floats = incoming;
        }
        let off = 0;
        for (; off + WINDOW <= floats.length; off += WINDOW) {
          await runWindow(floats.subarray(off, off + WINDOW));
        }
        pending = floats.slice(off);
        onProgress?.(Math.min(1, processedSamples / totalSamples));
      };

      const flushPending = async (): Promise<void> => {
        // 末尾の半端な窓はゼロ埋めして処理する
        if (pending.length === 0) return;
        const window = new Float32Array(WINDOW);
        window.set(pending);
        pending = new Float32Array(0);
        await runWindow(window);
      };

      proc.stdout.on('data', (buf: Buffer) => {
        const data = Buffer.concat([leftover, buf]);
        const usable = data.length - (data.length % 4);
        const chunk = data.subarray(0, usable);
        leftover = data.subarray(usable);
        // Buffer → Float32Array(アライメント保証のためコピー)
        const floats = new Float32Array(usable / 4);
        for (let i = 0; i < floats.length; i++) {
          floats[i] = chunk.readFloatLE(i * 4);
        }
        chain = chain.then(() => {
          if (chainError) return;
          return processFloats(floats).catch((e) => {
            chainError = e as Error;
          });
        });
      });

      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => {
        chain
          .then(async () => {
            if (chainError) {
              reject(chainError);
            } else if (code !== 0) {
              reject(new Error(`ffmpeg(audio) failed (${code})`));
            } else {
              await flushPending();
              resolve(probs);
            }
          })
          .catch(reject);
      });
    });
  }

  private zeros(dims: number[]): import('onnxruntime-node').Tensor {
    const size = dims.reduce((a, b) => a * b, 1);
    return new this.ort.Tensor('float32', new Float32Array(size), dims);
  }
}
