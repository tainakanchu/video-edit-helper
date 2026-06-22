// server を 1 ファイルの CJS にバンドルする(pkg で単一バイナリ化する前段)。
// onnxruntime-node はネイティブアドオンのため external 化して同梱しない。
// (パッケージ版は VEH_DISABLE_SILERO=1 で silencedetect にフォールバックする)
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

await build({
  entryPoints: [path.join(root, 'src/index.ts')],
  outfile: path.join(root, 'dist-bundle/veh-server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // ネイティブ .node アドオンはバンドル不可。スタブに差し替えて pkg が巻き込むのを防ぐ。
  // (動的 import 時に throw → selectVadProvider が silencedetect にフォールバック)
  alias: { 'onnxruntime-node': path.join(here, 'ort-stub.js') },
  // CJS では import.meta.url が空になるため __filename 基準の URL に置換する。
  // (パッケージ版は VEH_WEB_DIST 等の env でパスを上書きするので主に dev 直接実行時の保険)
  banner: { js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__import_meta_url' },
  logLevel: 'info',
  // pkg が __dirname を解決できるよう keepNames は不要。サイズより堅牢性優先で minify しない。
  minify: false,
  sourcemap: false,
});

console.log('[bundle] → packages/server/dist-bundle/veh-server.cjs');
