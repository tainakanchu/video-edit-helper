/**
 * History API ベースの手書きルーター(純ロジック部)。
 *
 * URL を唯一の真実とする。store の view 状態はここから派生させる。
 * parseRoute / buildPath は純関数でテスト対象。
 *
 * ルート:
 *   /setup
 *   /map
 *   /day/:dayId
 *   /day/:dayId/triage
 *   /clip/:clipId            (?t=<秒> で初期シーク位置)
 *   /search                  (?q=...)
 *   /                        → プロジェクト状態に応じて解決(呼び出し側)
 *   不明パス                 → '/'(呼び出し側で解決)
 */

import type { ID } from '@veh/shared';

export type Route =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'map' }
  | { name: 'day'; dayId: ID }
  | { name: 'triage'; dayId: ID }
  | { name: 'clip'; clipId: ID; t: number | null }
  | { name: 'search'; q: string };

/** pathname + search 文字列(例: '?t=12.5')から Route を導出する純関数 */
export function parseRoute(pathname: string, search = ''): Route {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);

  // 末尾スラッシュを正規化(ルート '/' は残す)
  let path = pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '');

  if (path === '/' || path === '') return { name: 'home' };

  const segs = path.split('/').filter((s) => s.length > 0);

  if (segs.length === 1) {
    if (segs[0] === 'setup') return { name: 'setup' };
    if (segs[0] === 'map') return { name: 'map' };
    if (segs[0] === 'search') return { name: 'search', q: params.get('q') ?? '' };
  }

  if (segs[0] === 'day' && segs[1]) {
    const dayId = decodeURIComponent(segs[1]);
    if (segs.length === 2) return { name: 'day', dayId };
    if (segs.length === 3 && segs[2] === 'triage') return { name: 'triage', dayId };
  }

  if (segs[0] === 'clip' && segs[1] && segs.length === 2) {
    const clipId = decodeURIComponent(segs[1]);
    const tRaw = params.get('t');
    const t = tRaw !== null && tRaw !== '' && Number.isFinite(Number(tRaw)) ? Number(tRaw) : null;
    return { name: 'clip', clipId, t };
  }

  // 不明パス
  return { name: 'home' };
}

/** Route から URL パス(pathname + 必要なら ?query)を組み立てる純関数 */
export function buildPath(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/';
    case 'setup':
      return '/setup';
    case 'map':
      return '/map';
    case 'day':
      return `/day/${encodeURIComponent(route.dayId)}`;
    case 'triage':
      return `/day/${encodeURIComponent(route.dayId)}/triage`;
    case 'clip': {
      const base = `/clip/${encodeURIComponent(route.clipId)}`;
      if (route.t !== null && Number.isFinite(route.t)) {
        return `${base}?t=${route.t}`;
      }
      return base;
    }
    case 'search': {
      if (route.q) return `/search?q=${encodeURIComponent(route.q)}`;
      return '/search';
    }
  }
}

/** 2 つの Route が同じ URL を指すか(navigate のループ防止用) */
export function routesEqual(a: Route, b: Route): boolean {
  return buildPath(a) === buildPath(b);
}
