import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { apiPaths } from '@veh/shared';

/**
 * ローカル API の保護。
 *
 * サーバーは認証なしで動画ファイル・文字起こし・メモにアクセスできるため、
 * 次の 3 段で「このアプリの UI からの要求だけ」を通す。
 *  1. Host ヘッダの検証(DNS rebinding 対策。127.0.0.1 bind でもブラウザ経由で届くため)
 *  2. Origin の検証(他サイトからの CSRF / 読み取り対策。CORS も同じ許可リスト)
 *  3. 起動ごとのランダムトークン(同一マシンの他プロセス・他サイトからの直接呼び出し対策)
 *
 * トークンの受け渡し:
 *  - Tauri / pnpm start: http://localhost:<port>/#veh-token=<token> を開く。UI が
 *    フラグメントを読み、POST /api/auth/session(X-VEH-Token ヘッダ)で HttpOnly Cookie に換える。
 *    フラグメントはサーバーへ送られないのでログ等に残らない。
 *  - dev(vite): vite の proxy が開発用トークンファイルを読んで X-VEH-Token を付ける。
 *  <img>/<video> はヘッダを付けられないため、Cookie でも受け付ける。
 */

export const TOKEN_HEADER = 'x-veh-token';

/** 開発用 vite(packages/web/vite.config.ts の server.port) */
const DEV_WEB_PORT = 5180;

export interface SecurityOptions {
  token: string;
  port: number;
  /** 追加で許可する Host(VEH_ALLOWED_HOSTS。LAN 公開を opt-in した場合など) */
  extraHosts?: string[];
  /** 追加で許可する Origin(VEH_ALLOWED_ORIGINS) */
  extraOrigins?: string[];
}

/** 起動ごとのトークン(URL / Cookie にそのまま載せられる base64url) */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** ポートごとに分ける(Cookie はポートを区別しないため、dev とアプリが混ざらないように) */
export function cookieName(port: number): string {
  return `veh_token_${port}`;
}

export function allowedHosts(opts: SecurityOptions): Set<string> {
  return new Set(
    [`localhost:${opts.port}`, `127.0.0.1:${opts.port}`, ...(opts.extraHosts ?? [])].map((h) =>
      h.toLowerCase(),
    ),
  );
}

export function allowedOrigins(opts: SecurityOptions): Set<string> {
  return new Set([
    `http://localhost:${opts.port}`,
    `http://127.0.0.1:${opts.port}`,
    `http://localhost:${DEV_WEB_PORT}`,
    `http://127.0.0.1:${DEV_WEB_PORT}`,
    // Tauri の WebView 自身の Origin(macOS/Linux: tauri://localhost、Windows: http(s)://tauri.localhost)
    'tauri://localhost',
    'http://tauri.localhost',
    'https://tauri.localhost',
    ...(opts.extraOrigins ?? []),
  ]);
}

/** 長さが違っても例外にならない定数時間比較 */
export function tokenMatches(expected: string, given: string | undefined): boolean {
  if (typeof given !== 'string' || given === '') return false;
  const a = crypto.createHash('sha256').update(expected).digest();
  const b = crypto.createHash('sha256').update(given).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Cookie ヘッダから 1 つ取り出す(@fastify/cookie を入れるほどではないので最小実装) */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function deny(reply: FastifyReply, status: number, message: string): FastifyReply {
  return reply.status(status).send({ error: message });
}

/** /api 配下か。生の URL だけでなく、マッチしたルート(%61pi 等のエンコード回避対策)でも判定する */
function isApiRequest(req: FastifyRequest): boolean {
  const route = req.routeOptions.url ?? '';
  return req.url.startsWith('/api') || route.startsWith('/api');
}

/** Host / Origin / トークンの検証と CORS を登録する。ルート登録より前に呼ぶこと */
export async function registerSecurity(app: FastifyInstance, opts: SecurityOptions): Promise<void> {
  const hosts = allowedHosts(opts);
  const origins = allowedOrigins(opts);
  const cookie = cookieName(opts.port);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // 1. Host: 静的 UI も含めて全リクエストで確認する(DNS rebinding で UI を読ませない)
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) return deny(reply, 403, 'forbidden host');

    // 2. Origin: ブラウザは他オリジンからの fetch / 非 GET に必ず付ける。付いていれば許可リストと照合
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) return deny(reply, 403, 'forbidden origin');

    // 3. トークン: /api 配下のみ(UI の HTML/JS 自体は秘密ではない)。preflight はヘッダを持たない
    if (!isApiRequest(req) || req.method === 'OPTIONS') return;
    const header = req.headers[TOKEN_HEADER];
    const given = typeof header === 'string' ? header : readCookie(req.headers.cookie, cookie);
    if (!tokenMatches(opts.token, given)) return deny(reply, 401, 'unauthorized');
  });

  await app.register(cors, { origin: [...origins] });

  // POST /api/auth/session — ヘッダのトークンを HttpOnly Cookie に換える(<img>/<video> 用)
  app.post(apiPaths.authSession(), async (_req, reply) => {
    void reply
      .header('Set-Cookie', `${cookie}=${opts.token}; Path=/; HttpOnly; SameSite=Strict`)
      .status(204)
      .send();
  });
}

/** 開発用トークンファイル(vite proxy が読む)を所有者のみ読み書き可で書き出す */
export function writeTokenFile(file: string, token: string): void {
  // 既存ファイル(他ユーザーが置いたシンボリックリンク等)を辿らないよう、消してから新規作成する
  fs.rmSync(file, { force: true });
  fs.writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
}
