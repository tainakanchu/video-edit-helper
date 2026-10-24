import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  allowedOrigins,
  cookieName,
  generateToken,
  readCookie,
  registerSecurity,
  tokenMatches,
} from './security.js';

const PORT = 4810;
const HOST = `localhost:${PORT}`;
let token: string;
let app: FastifyInstance;

beforeEach(async () => {
  token = generateToken();
  app = Fastify();
  await registerSecurity(app, { token, port: PORT, extraHosts: ['192.168.1.10:4810'] });
  app.get('/api/ping', async () => ({ ok: true }));
  app.post('/api/ping', async () => ({ ok: true }));
  app.get('/', async () => 'ui');
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('Host ヘッダ(DNS rebinding 対策)', () => {
  it('localhost / 127.0.0.1 の自ポートだけ通す', async () => {
    for (const host of [HOST, `127.0.0.1:${PORT}`]) {
      const res = await app.inject({ url: '/api/ping', headers: { host, 'x-veh-token': token } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('それ以外の Host は、正しいトークンがあっても UI ごと 403', async () => {
    for (const host of ['evil.example', `evil.example:${PORT}`, 'localhost:9999', `0.0.0.0:${PORT}`]) {
      const api = await app.inject({ url: '/api/ping', headers: { host, 'x-veh-token': token } });
      expect(api.statusCode).toBe(403);
      const ui = await app.inject({ url: '/', headers: { host } });
      expect(ui.statusCode).toBe(403);
    }
  });

  it('VEH_ALLOWED_HOSTS で足した Host は通す(LAN 公開の opt-in)', async () => {
    const res = await app.inject({
      url: '/api/ping',
      headers: { host: '192.168.1.10:4810', 'x-veh-token': token },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Origin と CORS', () => {
  it('他サイトの Origin は 403 で、CORS ヘッダも返さない', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ping',
      headers: { host: HOST, origin: 'https://evil.example', 'x-veh-token': token },
    });
    expect(res.statusCode).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('他サイトからの preflight も 403', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/ping',
      headers: {
        host: HOST,
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('dev の vite と Tauri の Origin は許可し、その Origin を CORS で返す', async () => {
    for (const origin of ['http://localhost:5180', 'tauri://localhost', `http://localhost:${PORT}`]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ping',
        headers: { host: HOST, origin, 'x-veh-token': token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('任意の Origin を反射しない(origin: true の退行防止)', () => {
    expect(allowedOrigins({ token, port: PORT }).has('https://evil.example')).toBe(false);
  });
});

describe('API トークン', () => {
  it('トークンなし・誤りは 401', async () => {
    const none = await app.inject({ url: '/api/ping', headers: { host: HOST } });
    expect(none.statusCode).toBe(401);
    const wrong = await app.inject({ url: '/api/ping', headers: { host: HOST, 'x-veh-token': 'nope' } });
    expect(wrong.statusCode).toBe(401);
    const otherPortCookie = await app.inject({
      url: '/api/ping',
      headers: { host: HOST, cookie: `${cookieName(9999)}=${token}` },
    });
    expect(otherPortCookie.statusCode).toBe(401);
  });

  it('URL エンコードで /api を言い換えてもトークンを要求する', async () => {
    const res = await app.inject({ url: '/%61pi/ping', headers: { host: HOST } });
    expect(res.statusCode).not.toBe(200);
  });

  it('UI(/api 以外)はトークンなしで返す', async () => {
    const res = await app.inject({ url: '/', headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/auth/session でトークンを HttpOnly Cookie に換え、以後は Cookie で通る', async () => {
    const denied = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { host: HOST } });
    expect(denied.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/session',
      headers: { host: HOST, 'x-veh-token': token },
    });
    expect(res.statusCode).toBe(204);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`${cookieName(PORT)}=${token}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    const viaCookie = await app.inject({
      url: '/api/ping',
      headers: { host: HOST, cookie: `other=1; ${cookieName(PORT)}=${token}` },
    });
    expect(viaCookie.statusCode).toBe(200);
  });
});

describe('補助関数', () => {
  it('tokenMatches は完全一致だけ true', () => {
    expect(tokenMatches('abc', 'abc')).toBe(true);
    expect(tokenMatches('abc', 'abcd')).toBe(false);
    expect(tokenMatches('abc', '')).toBe(false);
    expect(tokenMatches('abc', undefined)).toBe(false);
  });

  it('readCookie は名前が完全一致するものだけ返す', () => {
    expect(readCookie('a=1; veh_token_1=x; b=2', 'veh_token_1')).toBe('x');
    expect(readCookie('xveh_token_1=y', 'veh_token_1')).toBeUndefined();
    expect(readCookie(undefined, 'veh_token_1')).toBeUndefined();
  });

  it('generateToken は毎回異なる 256bit のトークン', () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
});
