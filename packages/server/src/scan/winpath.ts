import fs from 'node:fs';
import path from 'node:path';

/** Windows ドライブパス(C:\... / C:/...)か判定 */
export function isWindowsDrivePath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p.trim());
}

/** 'C:\foo\bar' → '/mnt/c/foo/bar'(WSL のマウントパス)。非該当はそのまま返す */
export function windowsToWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p.trim());
  if (!m) return p;
  return `/mnt/${m[1]!.toLowerCase()}/${m[2]!.replaceAll('\\', '/')}`;
}

/**
 * ID 計算用の正規化パス。同じ実体を指す WSL 形式(/mnt/c/...)と
 * Windows 形式(C:\...)を同一文字列に揃え、実行環境を移っても
 * クリップ ID が安定しメモ・進捗が引き継がれるようにする。
 * 例: 'C:\\foo\\Bar.MP4' / '/mnt/c/foo/Bar.MP4' → 'c:/foo/Bar.MP4'
 */
export function canonicalMediaPath(p: string): string {
  const win = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (win) return `${win[1]!.toLowerCase()}:/${win[2]!.replaceAll('\\', '/')}`;
  const wsl = /^\/mnt\/([a-zA-Z])\/(.*)$/.exec(p);
  if (wsl) return `${wsl[1]!.toLowerCase()}:/${wsl[2]!}`;
  return p;
}

/**
 * メディアルートの実在解決。Linux(WSL)上では Windows 形式の入力を
 * /mnt/<drive>/ に変換して探す。見つからなければ null。
 */
export function resolveMediaRoot(
  input: string,
  opts: { platform?: NodeJS.Platform; exists?: (p: string) => boolean } = {},
): string | null {
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
  const trimmed = input.trim();
  if (platform !== 'win32' && isWindowsDrivePath(trimmed)) {
    const wsl = windowsToWslPath(trimmed);
    return exists(wsl) ? wsl : null;
  }
  // platform 指定に応じたリゾルバを使う(テストで他 OS をシミュレートできるように)
  const abs = (platform === 'win32' ? path.win32 : path.posix).resolve(trimmed);
  return exists(abs) ? abs : null;
}
