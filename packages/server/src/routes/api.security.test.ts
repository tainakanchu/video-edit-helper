import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clip } from '@veh/shared';
import { loadConfig, type Config } from '../config.js';
import { ProjectStore } from '../store/projectStore.js';
import { MountStore } from '../media/mounts.js';
import { TranscriptCache } from '../search/transcriptCache.js';
import type { JobQueue } from '../jobs/queue.js';
import type { JobCoordinator } from '../jobs/coordinator.js';
import { registerRoutes } from './api.js';
import { registerSecurity } from '../security.js';
import { safeIdSegment } from '../ids.js';

const CLIP_ID = 'abc123def456';
const PORT = 4810;
const TOKEN = 'test-token';
const headers = { host: `localhost:${PORT}`, 'x-veh-token': TOKEN };

let dir: string;
let config: Config;
let store: ProjectStore;
let app: FastifyInstance;

function makeClip(id: string): Clip {
  return {
    id,
    dayId: '2025-01-01',
    name: 'C0001',
    cameraLabel: 'cam',
    files: [],
    durationSec: 10,
    recordedAt: '2025-01-01T00:00:00.000Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
  };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-api-sec-'));
  config = loadConfig({ VEH_PROJECT_DIR: path.join(dir, 'project') });
  store = ProjectStore.load({
    projectFile: config.projectFile,
    backupsDir: config.backupsDir,
    saveDebounceMs: 0,
  });
  store.getState().clips[CLIP_ID] = makeClip(CLIP_ID);

  // トラバーサルで読まれてはいけない、キャッシュ外の JSON
  fs.writeFileSync(
    path.join(config.projectDir, 'secret.json'),
    JSON.stringify({ secret: 'TOP-SECRET', segments: [], speech: [], scenes: [] }),
  );

  app = Fastify();
  await registerSecurity(app, { token: TOKEN, port: PORT });
  registerRoutes(app, {
    config,
    store,
    queue: {} as JobQueue,
    coordinator: {} as JobCoordinator,
    transcriptCache: new TranscriptCache(config),
    mounts: new MountStore(path.join(dir, 'mounts.json')),
  });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  store.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('H2: :clipId のパストラバーサル', () => {
  // transcriptsDir 等は <projectDir>/cache/<kind>/ なので ../../secret が secret.json を指す
  const traversalIds = [
    '..%2F..%2Fsecret',
    '..%252F..%252Fsecret',
    '..',
    '..%5C..%5Csecret',
    'ABC123',
    '__proto__',
  ];
  const routes = [
    (id: string) => ({ method: 'GET' as const, url: `/api/clips/${id}/transcript` }),
    (id: string) => ({ method: 'GET' as const, url: `/api/clips/${id}/vad` }),
    (id: string) => ({ method: 'GET' as const, url: `/api/clips/${id}/scenes` }),
    (id: string) => ({ method: 'GET' as const, url: `/api/clips/${id}/thumbs` }),
    (id: string) => ({ method: 'GET' as const, url: `/api/thumbs/${id}/10/0.jpg` }),
    (id: string) => ({ method: 'PATCH' as const, url: `/api/clips/${id}/review`, payload: { reviewStatus: 'reviewed' } }),
    (id: string) => ({ method: 'POST' as const, url: `/api/clips/${id}/watched`, payload: { ranges: [] } }),
    (id: string) => ({ method: 'POST' as const, url: `/api/clips/${id}/notes`, payload: { timeSec: 0, text: 'x' } }),
    (id: string) => ({ method: 'POST' as const, url: `/api/clips/${id}/selections`, payload: { inSec: 0, outSec: 1 } }),
  ];

  it('不正な clipId はどのルートでも 400/404 になり、キャッシュ外のファイルを返さない', async () => {
    for (const id of traversalIds) {
      for (const route of routes) {
        const req = route(id);
        const res = await app.inject({ ...req, headers });
        expect([400, 404], `${req.method} ${req.url} → ${res.statusCode}`).toContain(res.statusCode);
        expect(res.body).not.toContain('TOP-SECRET');
      }
    }
  });

  it('存在しない正しい形式の clipId は 404', async () => {
    const res = await app.inject({ url: '/api/clips/0123456789ab/transcript', headers });
    expect(res.statusCode).toBe(404);
  });

  it('正しい clipId のキャッシュは読める', async () => {
    fs.writeFileSync(
      path.join(config.transcriptsDir, `${CLIP_ID}.json`),
      JSON.stringify({ clipId: CLIP_ID, segments: [] }),
    );
    const res = await app.inject({ url: `/api/clips/${CLIP_ID}/transcript`, headers });
    expect(res.statusCode).toBe(200);
  });

  it('キャッシュのパスを組み立てる関数自体も区切り文字や .. を拒否する', () => {
    expect(safeIdSegment(CLIP_ID)).toBe(CLIP_ID);
    for (const bad of ['../x', '..', 'a/b', 'a\\b', '', 'x'.repeat(65)]) {
      expect(() => safeIdSegment(bad)).toThrow();
    }
  });
});

describe('M7: noteId / selectionId による prototype pollution', () => {
  const protoKeys = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

  afterEach(() => {
    // 万一汚染されていたら後続テストに漏らさない
    for (const k of ['text', 'tags', 'status', 'timeSec', 'updatedAt', 'inSec', 'outSec', 'reviewStatus']) {
      delete (Object.prototype as Record<string, unknown>)[k];
    }
  });

  it('PATCH / DELETE /api/notes/:noteId に __proto__ 等を渡しても 404 で、Object.prototype は変わらない', async () => {
    for (const id of protoKeys) {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/notes/${id}`,
        headers,
        payload: { text: 'polluted', status: 'discarded', timeSec: 1 },
      });
      expect(patch.statusCode).toBe(404);
      const del = await app.inject({ method: 'DELETE', url: `/api/notes/${id}`, headers });
      expect(del.statusCode).toBe(404);
    }
    const probe = {} as Record<string, unknown>;
    expect(probe.text).toBeUndefined();
    expect(probe.status).toBeUndefined();
    expect(typeof Object.prototype.toString).toBe('function');
  });

  it('PATCH / DELETE /api/selections/:selectionId に __proto__ 等を渡しても 404', async () => {
    for (const id of protoKeys) {
      const patch = await app.inject({
        method: 'PATCH',
        url: `/api/selections/${id}`,
        headers,
        payload: { text: 'polluted', inSec: 0, outSec: 1 },
      });
      expect(patch.statusCode).toBe(404);
      const del = await app.inject({ method: 'DELETE', url: `/api/selections/${id}`, headers });
      expect(del.statusCode).toBe(404);
    }
    const probe = {} as Record<string, unknown>;
    expect(probe.text).toBeUndefined();
    expect(probe.inSec).toBeUndefined();
  });

  it('選定範囲の作成で noteId に __proto__ を渡しても Object.prototype.status を書かない', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/clips/${CLIP_ID}/selections`,
      headers,
      payload: { inSec: 0, outSec: 1, noteId: '__proto__' },
    });
    expect(res.statusCode).toBe(200);
    expect(({} as Record<string, unknown>).status).toBeUndefined();
  });

  it('ストア直呼びでも clipId に __proto__ を渡すと undefined を返す', () => {
    expect(store.getClip('__proto__')).toBeUndefined();
    expect(store.getClip('constructor')).toBeUndefined();
    expect(store.setReviewStatus('__proto__', 'reviewed')).toBeUndefined();
    expect(store.addWatchedRanges('__proto__', [{ start: 0, end: 1 }])).toBeUndefined();
    expect(store.getSelection('__proto__')).toBeUndefined();
    expect(store.updateNote('__proto__', { text: 'x' })).toBeUndefined();
    expect(store.deleteNote('__proto__')).toBe(false);
    expect(store.deleteSelection('__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).reviewStatus).toBeUndefined();
  });
});

describe('H1: ルート全体がトークンで保護されている', () => {
  it('トークンなしでは /api/project も読めない', async () => {
    const res = await app.inject({ url: '/api/project', headers: { host: `localhost:${PORT}` } });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('mediaRoots');
  });

  it('Host が違えばトークンがあっても読めない', async () => {
    const res = await app.inject({
      url: '/api/project',
      headers: { host: 'attacker.example:4810', 'x-veh-token': TOKEN },
    });
    expect(res.statusCode).toBe(403);
  });
});
