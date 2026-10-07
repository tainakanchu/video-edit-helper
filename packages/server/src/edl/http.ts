import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  apiPaths,
  type EdlSource,
  type EdlSourcesResponse,
  type EdlTimelineResponse,
  type PathRewrite,
} from '@veh/shared';
import type { ProjectStore } from '../store/projectStore.js';
import { canonicalMediaPath } from '../scan/winpath.js';
import { buildMediaResponse } from '../media/stream.js';
import { readEdlFile } from './parse.js';
import { buildTimeline, resolveAssetFile } from './plan.js';
import { resolveEdlPath, type PathResolveOpts } from './paths.js';
import { addComment, deleteComment, readComments } from './comments.js';

function sendError(reply: FastifyReply, status: number, message: string): void {
  void reply.status(status).send({ error: message });
}

/** 中間ファイルの付帯情報など小さなテキストを読む。読めなければ null */
function readSmallText(p: string): string | null {
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 1024 * 1024) return null;
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function pathOpts(store: ProjectStore): PathResolveOpts {
  const settings = store.getSettings();
  return {
    platform: process.platform,
    exists: (p) => fs.existsSync(p),
    rewrites: settings.pathRewrites ?? [],
    wslDistro: settings.wslDistro ?? '',
  };
}

function sourcesResponse(store: ProjectStore): EdlSourcesResponse {
  const s = store.getSettings();
  return {
    sources: s.edlSources ?? [],
    activeEdlId: s.activeEdlId ?? null,
    pathRewrites: s.pathRewrites ?? [],
    wslDistro: s.wslDistro ?? '',
  };
}

async function realOf(p: string): Promise<string> {
  try {
    return await fsp.realpath(p);
  } catch {
    return p;
  }
}

function baseName(p: string): string {
  const norm = p.replaceAll('\\', '/');
  const i = norm.lastIndexOf('/');
  return i >= 0 ? norm.slice(i + 1) : norm;
}

const addSchema = z.object({
  path: z.string().min(1),
  cacheDir: z.string().optional(),
  label: z.string().optional(),
});

const updateSchema = z.object({
  label: z.string().optional(),
  cacheDir: z.string().optional(),
});

const activeSchema = z.object({
  id: z.string().nullable(),
});

const rewritesSchema = z.object({
  pathRewrites: z.array(z.object({ from: z.string(), to: z.string() })),
  wslDistro: z.string().optional(),
});

const commentSchema = z.object({
  segmentId: z.string().min(1),
  timeSec: z.number().min(0),
  text: z.string(),
});

function findProxyUrl(store: ProjectStore, resolvedPath: string): string | null {
  const want = canonicalMediaPath(resolvedPath);
  for (const clip of store.getAllClips()) {
    for (const f of clip.files) {
      if (!f.playableInBrowser && f.proxyAvailable && canonicalMediaPath(f.path) === want) {
        return apiPaths.mediaProxy(f.id);
      }
    }
  }
  return null;
}

/** /api/edl 以下。static パスを :id より先に登録する */
export function registerEdlRoutes(app: FastifyInstance, store: ProjectStore): void {
  app.get(apiPaths.edls(), async (): Promise<EdlSourcesResponse> => sourcesResponse(store));

  app.post(apiPaths.edls(), async (req, reply): Promise<EdlSourcesResponse | void> => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    const opts = pathOpts(store);
    const resolved = resolveEdlPath([parsed.data.path], opts);
    if (!resolved) return sendError(reply, 400, 'EDL ファイルが見つかりません');
    const docResult = await readEdlFile(resolved);
    if (!docResult.ok) return sendError(reply, 400, docResult.error);
    const real = await realOf(resolved);

    const existing = await (async () => {
      for (const s of store.getSettings().edlSources ?? []) {
        const r = resolveEdlPath([s.path], opts);
        if (!r) continue;
        if ((await realOf(r)) === real) return s;
      }
      return undefined;
    })();

    const source: EdlSource = {
      id: existing?.id ?? nanoid(12),
      path: parsed.data.path.trim(),
      label:
        parsed.data.label?.trim() ||
        existing?.label ||
        docResult.doc.title ||
        baseName(parsed.data.path),
      cacheDir:
        parsed.data.cacheDir !== undefined ? parsed.data.cacheDir : (existing?.cacheDir ?? ''),
    };
    store.upsertEdl(source, true);
    return sourcesResponse(store);
  });

  app.post(apiPaths.edlActive(), async (req, reply): Promise<EdlSourcesResponse | void> => {
    const parsed = activeSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    if (parsed.data.id !== null) {
      const found = (store.getSettings().edlSources ?? []).some((s) => s.id === parsed.data.id);
      if (!found) return sendError(reply, 404, 'EDL が見つかりません');
    }
    store.setActiveEdl(parsed.data.id);
    return sourcesResponse(store);
  });

  app.put(apiPaths.edlPathRewrites(), async (req, reply): Promise<EdlSourcesResponse | void> => {
    const parsed = rewritesSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    const rewrites: PathRewrite[] = [];
    for (const r of parsed.data.pathRewrites) {
      const from = r.from.trim();
      const to = r.to.trim();
      if (!from || !to) continue;
      rewrites.push({ from, to });
    }
    store.setPathRewrites(rewrites, parsed.data.wslDistro);
    return sourcesResponse(store);
  });

  app.patch<{ Params: { id: string } }>(
    '/api/edl/:id',
    async (req, reply): Promise<EdlSourcesResponse | void> => {
      const parsed = updateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const updated = store.updateEdl(req.params.id, parsed.data);
      if (!updated) return sendError(reply, 404, 'EDL が見つかりません');
      return sourcesResponse(store);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/edl/:id',
    async (req, reply): Promise<EdlSourcesResponse | void> => {
      const ok = store.removeEdl(req.params.id);
      if (!ok) return sendError(reply, 404, 'EDL が見つかりません');
      return sourcesResponse(store);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/edl/:id/timeline',
    async (req, reply): Promise<EdlTimelineResponse | void> => {
      const source = (store.getSettings().edlSources ?? []).find((s) => s.id === req.params.id);
      if (!source) return sendError(reply, 404, 'EDL が見つかりません');
      const opts = pathOpts(store);
      const resolved = resolveEdlPath([source.path], opts);
      if (!resolved) return sendError(reply, 400, 'EDL ファイルが見つかりません');
      const docResult = await readEdlFile(resolved);
      if (!docResult.ok) return sendError(reply, 400, docResult.error);
      const timeline = buildTimeline(docResult.doc, {
        sourceId: source.id,
        platform: process.platform,
        exists: (p) => fs.existsSync(p),
        cacheDir: source.cacheDir,
        rewrites: store.getSettings().pathRewrites ?? [],
        wslDistro: store.getSettings().wslDistro ?? '',
        assetUrl: (role, key) => apiPaths.edlAsset(source.id, role, key),
        findProxyUrl: (p) => findProxyUrl(store, p),
        readText: readSmallText,
      });
      return { timeline };
    },
  );

  app.get<{ Params: { id: string; role: string; key: string } }>(
    '/api/edl/:id/asset/:role/:key',
    async (req, reply): Promise<void> => {
      const source = (store.getSettings().edlSources ?? []).find((s) => s.id === req.params.id);
      if (!source) return sendError(reply, 404, 'EDL が見つかりません');
      const opts = pathOpts(store);
      const resolved = resolveEdlPath([source.path], opts);
      if (!resolved) return sendError(reply, 404, 'EDL ファイルが見つかりません');
      const docResult = await readEdlFile(resolved);
      if (!docResult.ok) return sendError(reply, 400, docResult.error);
      const filePath = resolveAssetFile(
        docResult.doc,
        source.cacheDir,
        req.params.role,
        req.params.key,
        opts,
        readSmallText,
      );
      if (!filePath) return sendError(reply, 404, '素材が見つかりません');
      let size: number;
      try {
        size = (await fsp.stat(filePath)).size;
      } catch {
        return sendError(reply, 404, '素材が見つかりません');
      }
      const res = buildMediaResponse(filePath, size, req.headers.range);
      for (const [k, v] of Object.entries(res.headers)) {
        void reply.header(k, v);
      }
      void reply.status(res.statusCode);
      if (res.stream) {
        return reply.send(res.stream);
      }
      void reply.send(res.body ?? '');
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/edl/:id/comments',
    async (req, reply) => {
      const source = (store.getSettings().edlSources ?? []).find((s) => s.id === req.params.id);
      if (!source) return sendError(reply, 404, 'EDL が見つかりません');
      const resolved = resolveEdlPath([source.path], pathOpts(store));
      if (!resolved) return sendError(reply, 400, 'EDL ファイルが見つかりません');
      return { comments: readComments(resolved) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/edl/:id/comments',
    async (req, reply) => {
      const source = (store.getSettings().edlSources ?? []).find((s) => s.id === req.params.id);
      if (!source) return sendError(reply, 404, 'EDL が見つかりません');
      const parsed = commentSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const opts = pathOpts(store);
      const resolved = resolveEdlPath([source.path], opts);
      if (!resolved) return sendError(reply, 400, 'EDL ファイルが見つかりません');
      const docResult = await readEdlFile(resolved);
      if (!docResult.ok) return sendError(reply, 400, docResult.error);
      const seg = docResult.doc.segments.find((s) => s.id === parsed.data.segmentId);
      if (!seg) return sendError(reply, 400, '区間が見つかりません');
      try {
        const comment = addComment(resolved, parsed.data);
        return { comment };
      } catch (err) {
        return sendError(reply, 400, err instanceof Error ? err.message : 'コメントを保存できません');
      }
    },
  );

  app.delete<{ Params: { id: string; commentId: string } }>(
    '/api/edl/:id/comments/:commentId',
    async (req, reply): Promise<void> => {
      const source = (store.getSettings().edlSources ?? []).find((s) => s.id === req.params.id);
      if (!source) return sendError(reply, 404, 'EDL が見つかりません');
      const resolved = resolveEdlPath([source.path], pathOpts(store));
      if (!resolved) return sendError(reply, 400, 'EDL ファイルが見つかりません');
      const ok = deleteComment(resolved, req.params.commentId);
      if (!ok) return sendError(reply, 404, 'コメントが見つかりません');
      void reply.status(204).send();
    },
  );
}
