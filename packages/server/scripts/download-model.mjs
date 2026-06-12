// Silero VAD の ONNX モデルを取得する。既存ならスキップ。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, '..', 'models');
const dest = path.join(modelsDir, 'silero_vad.onnx');

// master ブランチ上の現行パス候補(将来移動しても拾えるよう複数試す)
const CANDIDATE_URLS = [
  'https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx',
  'https://raw.githubusercontent.com/snakers4/silero-vad/master/files/silero_vad.onnx',
];

async function main() {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[download-model] 既存のためスキップ: ${dest}`);
    return;
  }
  fs.mkdirSync(modelsDir, { recursive: true });

  for (const url of CANDIDATE_URLS) {
    try {
      console.log(`[download-model] fetching ${url}`);
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  -> ${res.status} ${res.statusText}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 1000) {
        console.warn(`  -> 取得サイズが小さすぎます (${buf.length} bytes)`);
        continue;
      }
      fs.writeFileSync(dest, buf);
      console.log(`[download-model] saved ${dest} (${buf.length} bytes)`);
      return;
    } catch (e) {
      console.warn(`  -> error: ${e.message}`);
    }
  }
  console.error('[download-model] すべての候補 URL で取得に失敗しました');
  process.exit(1);
}

main();
