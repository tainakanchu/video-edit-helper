/** ファイルパス → file:// URL 変換 */
export function pathToFileUrl(p: string): string {
  // バックスラッシュを正規化
  const normalized = p.replaceAll('\\', '/');

  let driveLetter: string | null = null;
  let segments: string[];

  // WSL パス判定: /mnt/<d>/...
  const wslMatch = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
  if (wslMatch) {
    driveLetter = wslMatch[1]!.toUpperCase();
    segments = wslMatch[2]!.split('/').filter(s => s.length > 0);
    const encodedSegs = segments.map(s => encodeURIComponent(s));
    return `file:///${driveLetter}:/${encodedSegs.join('/')}`;
  }

  // Windows ドライブパス判定: X:/...
  const winMatch = normalized.match(/^([a-zA-Z]):\/?(.*)/);
  if (winMatch) {
    driveLetter = winMatch[1]!.toUpperCase();
    segments = winMatch[2]!.split('/').filter(s => s.length > 0);
    const encodedSegs = segments.map(s => encodeURIComponent(s));
    return `file:///${driveLetter}:/${encodedSegs.join('/')}`;
  }

  // POSIX パス
  segments = normalized.split('/').filter(s => s.length > 0);
  const encodedSegs = segments.map(s => encodeURIComponent(s));
  return `file:///${encodedSegs.join('/')}`;
}
