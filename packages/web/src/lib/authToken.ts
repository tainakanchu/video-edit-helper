import { apiPaths, TOKEN_FRAGMENT_KEY } from '@veh/shared';

/**
 * URL フラグメント(#veh-token=...)から API トークンを取り出す純関数。
 * rest はトークンを除いた残りのフラグメント(先頭 # なし。無ければ '')。
 */
export function takeTokenFromHash(hash: string): { token: string | null; rest: string } {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const token = params.get(TOKEN_FRAGMENT_KEY);
  params.delete(TOKEN_FRAGMENT_KEY);
  return { token: token && token !== '' ? token : null, rest: params.toString() };
}

/**
 * 起動時に 1 度呼ぶ。フラグメントにトークンがあればサーバーで HttpOnly Cookie に換え、
 * アドレスバー・履歴からトークンを消す。dev(vite proxy がヘッダを付ける)では何もしない。
 */
export async function establishSession(): Promise<void> {
  const { token, rest } = takeTokenFromHash(window.location.hash);
  if (!token) return;
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}${rest ? `#${rest}` : ''}`);
  try {
    await fetch(apiPaths.authSession(), {
      method: 'POST',
      headers: { 'X-VEH-Token': token },
      credentials: 'same-origin',
    });
  } catch {
    // 失敗しても UI は起動させる(API 呼び出し側で 401 として表示される)
  }
}
