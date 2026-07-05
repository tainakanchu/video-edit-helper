// バンドル済み CJS を @yao-pkg/pkg で単一実行ファイルにする。
// 出力名は Tauri の externalBin 規約 `<name>-<rust-target-triple>[.exe]` に合わせ、
// src-tauri/binaries/ に配置する(tauri.conf.json の externalBin: ["binaries/veh-server"])。
import { exec } from '@yao-pkg/pkg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const repoRoot = path.resolve(serverRoot, '..', '..');

const NODE = 'node22';
// host(platform-arch) → { pkg ターゲット, Rust トリプル, 拡張子 }
const MAP = {
  'darwin-arm64': { pkg: `${NODE}-macos-arm64`, triple: 'aarch64-apple-darwin', ext: '' },
  'darwin-x64': { pkg: `${NODE}-macos-x64`, triple: 'x86_64-apple-darwin', ext: '' },
  'linux-x64': { pkg: `${NODE}-linux-x64`, triple: 'x86_64-unknown-linux-gnu', ext: '' },
  'linux-arm64': { pkg: `${NODE}-linux-arm64`, triple: 'aarch64-unknown-linux-gnu', ext: '' },
  'win32-x64': { pkg: `${NODE}-win-x64`, triple: 'x86_64-pc-windows-msvc', ext: '.exe' },
};

// CI 等から明示指定する場合は VEH_RUST_TRIPLE(+任意で VEH_PKG_TARGET)で上書き
const hostKey = `${process.platform}-${process.arch}`;
let sel = MAP[hostKey];
if (process.env.VEH_RUST_TRIPLE) {
  const triple = process.env.VEH_RUST_TRIPLE;
  const ext = triple.includes('windows') ? '.exe' : '';
  const pkgTarget =
    process.env.VEH_PKG_TARGET ??
    Object.values(MAP).find((m) => m.triple === triple)?.pkg;
  if (!pkgTarget) throw new Error(`VEH_PKG_TARGET が必要です (triple=${triple})`);
  sel = { pkg: pkgTarget, triple, ext };
}
if (!sel) {
  throw new Error(`未対応のホスト ${hostKey}。VEH_RUST_TRIPLE/VEH_PKG_TARGET で指定してください`);
}

const entry = path.join(serverRoot, 'dist-bundle', 'veh-server.cjs');
if (!fs.existsSync(entry)) {
  throw new Error(`バンドルがありません: ${entry}(先に bundle.mjs を実行)`);
}
const outDir = path.join(repoRoot, 'src-tauri', 'binaries');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `veh-server-${sel.triple}${sel.ext}`);

console.log(`[pkg] host=${hostKey} target=${sel.pkg} → ${path.relative(repoRoot, outFile)}`);
await exec([entry, '--target', sel.pkg, '--output', outFile]);
// 実行権限を付与(unix)
if (!sel.ext) fs.chmodSync(outFile, 0o755);
console.log('[pkg] done');
