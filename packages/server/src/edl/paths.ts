import type { PathRewrite } from '@veh/shared';

export interface PathResolveOpts {
  platform: NodeJS.Platform;
  exists: (p: string) => boolean;
  rewrites: PathRewrite[];
  /** 空なら wslDistroCandidates を試す */
  wslDistro: string;
  wslDistroCandidates?: string[];
}

const DEFAULT_DISTROS = ['Ubuntu', 'Debian', 'NixOS'];

function normSlash(p: string): string {
  return p.replaceAll('\\', '/').replace(/\/+$/, '');
}

/** 原文と、各置換規則を独立に適用したバリアント。from が長い順 */
export function rewriteVariants(input: string, rules: PathRewrite[]): string[] {
  const result = [input];
  const nIn = normSlash(input.trim());
  const sorted = [...rules]
    .filter((r) => r.from.trim() && r.to.trim())
    .sort((a, b) => normSlash(b.from).length - normSlash(a.from).length);
  for (const r of sorted) {
    const nFrom = normSlash(r.from.trim());
    if (!nFrom) continue;
    if (nIn !== nFrom && !nIn.startsWith(`${nFrom}/`)) continue;
    const rest = nIn.slice(nFrom.length);
    const toPosix = normSlash(r.to.trim());
    const joined = `${toPosix}${rest}`;
    const styled = r.to.includes('\\') ? joined.replaceAll('/', '\\') : joined;
    if (!result.includes(styled)) result.push(styled);
  }
  return result;
}

/** 1 つのパス文字列を、この OS で試しうる絶対パスへ展開する（存在するとは限らない） */
export function expandPath(raw: string, platform: 'win32' | 'posix', distros: string[]): string[] {
  const out: string[] = [];
  const push = (p: string) => {
    if (p && !out.includes(p)) out.push(p);
  };
  const trimmed = raw.trim();
  if (!trimmed) return out;
  const posix = trimmed.replaceAll('\\', '/');
  const unc = posix.match(/^\/\/wsl(?:\$|\.localhost)\/([^/]+)(\/.*)?$/i);

  if (platform === 'win32') {
    const drive = posix.match(/^([A-Za-z]):\/(.*)$/);
    if (drive) {
      push(`${drive[1]!.toUpperCase()}:\\${drive[2]!.replaceAll('/', '\\')}`);
    }
    const mnt = posix.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (mnt) {
      push(`${mnt[1]!.toUpperCase()}:\\${mnt[2]!.replaceAll('/', '\\')}`);
    }
    if (unc) {
      const rest = (unc[2] ?? '').replaceAll('/', '\\');
      push(`\\\\wsl$\\${unc[1]}${rest}`);
    }
    if (posix.startsWith('/')) {
      for (const d of distros) {
        push(`\\\\wsl$\\${d}${posix.replaceAll('/', '\\')}`);
      }
    }
  } else {
    if (posix.startsWith('/')) push(posix);
    const drive = posix.match(/^([A-Za-z]):\/(.*)$/);
    if (drive) push(`/mnt/${drive[1]!.toLowerCase()}/${drive[2]}`);
    if (unc?.[2]) push(unc[2]);
  }
  return out;
}

/**
 * 候補（src と srcWin など）から、この環境で読めるパスを返す。
 * 候補の順 → 置換前→置換後 → 環境ごとの展開、の順で exists が真の最初。
 */
export function resolveEdlPath(candidates: string[], opts: PathResolveOpts): string | null {
  const platform = opts.platform === 'win32' ? 'win32' : 'posix';
  const distros = opts.wslDistro.trim()
    ? [opts.wslDistro.trim()]
    : (opts.wslDistroCandidates ?? DEFAULT_DISTROS);
  for (const c of candidates) {
    if (!c || !c.trim()) continue;
    for (const variant of rewriteVariants(c, opts.rewrites)) {
      for (const p of expandPath(variant, platform, distros)) {
        if (opts.exists(p)) return p;
      }
    }
  }
  return null;
}

/** dir の区切りに合わせて結合する。path.join は使わない（他 OS の模擬テストのため） */
export function joinEdlPath(dir: string, name: string): string {
  if (dir.includes('\\')) return `${dir.replace(/\\+$/, '')}\\${name}`;
  return `${dir.replace(/\/+$/, '')}/${name}`;
}

/** win32 では srcWin を先に、それ以外では src を先に */
export function orderedMediaCandidates(
  platform: NodeJS.Platform,
  src: string | undefined,
  srcWin: string | undefined,
): string[] {
  const a = src?.trim() ?? '';
  const b = srcWin?.trim() ?? '';
  const list = platform === 'win32' ? [b, a] : [a, b];
  return list.filter((p) => p.length > 0);
}
