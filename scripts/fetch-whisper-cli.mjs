// 配布用 whisper-cli を src-tauri/resources/whisper/ に配置する。
// 取得元の優先順: VEH_WHISPER_CLI_SRC env → PATH → Homebrew prefix。
// ローカル検証では brew/nix のバイナリを使う(dylib 依存があるため真の配布は CI で静的ビルドする)。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const destDir = path.join(root, 'src-tauri', 'resources', 'whisper');
const dest = path.join(destDir, isWin ? 'whisper-cli.exe' : 'whisper-cli');

function tryCmd(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).split('\n')[0].trim();
  } catch {
    return null;
  }
}

function locate() {
  if (process.env.VEH_WHISPER_CLI_SRC) return process.env.VEH_WHISPER_CLI_SRC;
  const onPath = tryCmd(isWin ? 'where' : 'which', ['whisper-cli']);
  if (onPath && fs.existsSync(onPath)) return onPath;
  const brewPrefix = tryCmd('brew', ['--prefix']);
  if (brewPrefix) {
    const c = path.join(brewPrefix, 'bin', 'whisper-cli');
    if (fs.existsSync(c)) return c;
  }
  return null;
}

fs.mkdirSync(destDir, { recursive: true });
const src = locate();
if (!src || !fs.existsSync(src)) {
  console.warn(
    '[whisper-cli] 実体が見つかりませんでした。プレースホルダを配置します(配布前に CI で差し替えてください)',
  );
  fs.writeFileSync(dest, isWin ? '' : '#!/bin/sh\necho "whisper-cli placeholder" >&2\nexit 1\n');
  if (!isWin) fs.chmodSync(dest, 0o755);
  process.exit(0);
}
fs.copyFileSync(src, dest);
if (!isWin) fs.chmodSync(dest, 0o755);
console.log(`[whisper-cli] copied ${src} → ${path.relative(root, dest)}`);
