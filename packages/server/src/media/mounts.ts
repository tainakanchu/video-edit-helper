// cross-OS 対応: 素材ルートの「このマシンでの実パス」対応表(ローカル・非同期)。
//
// project.json(同期される)には素材の絶対パスが入るが、それは最初にスキャンしたマシンの
// OS 依存パス。別 OS のマシンでは、ここに「そのルート → このマシンでのマウント先」を1度だけ
// 登録すれば、保存済みパスの接頭辞を差し替えて解決できる(再スキャン不要・同期ファイルは無変更)。
import fs from 'node:fs';
import path from 'node:path';
import type { Clip } from '@veh/shared';
import { canonicalMediaPath } from '../scan/winpath.js';

/** 素材ルート(project.json の mediaRoots の文字列) → このマシンでの実パス */
export type MountMap = Record<string, string>;

/** 比較用に正規化(ドライブ小文字化・スラッシュ統一・末尾スラッシュ除去) */
function canon(p: string): string {
  return canonicalMediaPath(p).replace(/\/+$/, '');
}

/**
 * storedPath が root 配下なら、root からの相対セグメント配列を返す。配下でなければ null。
 * (Windows パスの `\` も正規化して比較する)
 */
export function relPartsUnder(storedPath: string, root: string): string[] | null {
  const cp = canon(storedPath);
  const cr = canon(root);
  if (cp === cr) return [];
  if (cp.startsWith(cr + '/')) {
    return cp
      .slice(cr.length + 1)
      .split('/')
      .filter((s) => s.length > 0);
  }
  return null;
}

/**
 * 保存済み絶対パスを、mounts(このマシンの対応表)で解決する純関数。
 * どのルートにも該当しない/対応表に無ければ、そのまま返す(= 同一マシンなら無変換)。
 */
export function resolveMediaPath(storedPath: string, mediaRoots: string[], mounts: MountMap): string {
  for (const root of mediaRoots) {
    const local = mounts[root];
    if (!local) continue;
    const parts = relPartsUnder(storedPath, root);
    if (parts) return path.join(local, ...parts);
  }
  return storedPath;
}

/**
 * このマシンの実パスを、mounts(このマシンの対応表)を使って保存形パスへ逆変換する純関数。
 * resolveMediaPath の逆方向(実パス→保存形)。スキャンが実パスで発見したファイルを、
 * project.json に書き戻す保存形パスに戻すために使う。
 * どの root の mount 先にも該当しなければ、localPath をそのまま返す。
 */
export function toStoredPath(localPath: string, mediaRoots: string[], mounts: MountMap): string {
  for (const root of mediaRoots) {
    const local = mounts[root];
    if (!local) continue;
    const parts = relPartsUnder(localPath, local);
    if (!parts) continue;
    if (parts.length === 0) return root;
    const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
    const trimmedRoot = root.replace(/[\\/]+$/, '');
    return trimmedRoot + sep + parts.join(sep);
  }
  return localPath;
}

/** ローカルの mount 対応表を読み書きし、パス解決を提供する */
export class MountStore {
  private mounts: MountMap = {};

  constructor(private readonly file: string) {
    try {
      this.mounts = JSON.parse(fs.readFileSync(this.file, 'utf8')) as MountMap;
    } catch {
      this.mounts = {};
    }
  }

  getAll(): MountMap {
    return { ...this.mounts };
  }

  set(root: string, localPath: string): void {
    if (localPath) this.mounts[root] = localPath;
    else delete this.mounts[root];
    this.persist();
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.mounts, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** 保存済みパスをこのマシン用に解決 */
  resolve(storedPath: string, mediaRoots: string[]): string {
    return resolveMediaPath(storedPath, mediaRoots, this.mounts);
  }

  /** このマシンの実パスを保存形パスへ逆変換(resolve の逆方向) */
  toStored(localPath: string, mediaRoots: string[]): string {
    return toStoredPath(localPath, mediaRoots, this.mounts);
  }

  /** clip の各ファイルパスをこのマシン用に解決した clip コピーを返す */
  resolveClip(clip: Clip, mediaRoots: string[]): Clip {
    return {
      ...clip,
      files: clip.files.map((f) => ({ ...f, path: this.resolve(f.path, mediaRoots) })),
    };
  }
}
