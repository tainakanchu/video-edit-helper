// whisper.cpp の ggml モデルを取得する。既存ならスキップ。
// 使い方: node scripts/download-whisper-model.mjs [size]
//   size: tiny / base / small / medium / large-v3-turbo など(default: small)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(here, '..', 'models');

const size = (process.argv[2] ?? 'small').trim();
const fileName = `ggml-${size}.bin`;
const dest = path.join(modelsDir, fileName);
const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`;

async function main() {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    console.log(`[download-whisper-model] 既存のためスキップ: ${dest}`);
    return;
  }
  fs.mkdirSync(modelsDir, { recursive: true });

  console.log(`[download-whisper-model] fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[download-whisper-model] 取得失敗: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) {
    console.error(`[download-whisper-model] 取得サイズが小さすぎます (${buf.length} bytes)`);
    process.exit(1);
  }
  fs.writeFileSync(dest, buf);
  console.log(`[download-whisper-model] saved ${dest} (${buf.length} bytes)`);
}

main().catch((e) => {
  console.error(`[download-whisper-model] error: ${e.message}`);
  process.exit(1);
});
