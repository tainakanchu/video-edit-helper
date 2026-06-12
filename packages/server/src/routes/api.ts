import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  apiPaths,
  type ClipResponse,
  type EnqueueResponse,
  type JobsResponse,
  type NoteResponse,
  type ProjectResponse,
  type ScanResponse,
  type ThumbsResponse,
  type VadResponse,
} from '@veh/shared';
import type { Config } from '../config.js';
import type { ProjectStore } from '../store/projectStore.js';
import type { JobQueue } from '../jobs/queue.js';
import { buildThumbManifest, thumbFilePath } from '../jobs/thumbnails.js';
import { readVadResult } from '../jobs/vad.js';
import { buildMediaResponse } from '../media/stream.js';
import type { JobCoordinator } from '../jobs/coordinator.js';

const settingsSchema = z.object({
  settings: z
    .object({
      mediaRoots: z.array(z.string()).optional(),
      dayStartHour: z.number().int().min(0).max(23).optional(),
      thumbCoarseIntervalSec: z.number().positive().optional(),
      thumbFineIntervalSec: z.number().positive().optional(),
    })
    .strict(),
});

const scanSchema = z.object({
  mediaRoots: z.array(z.string()).optional(),
});

const enqueueSchema = z.object({
  type: z.enum(['thumbs-coarse', 'thumbs-fine', 'vad']),
  clipIds: z.array(z.string()).optional(),
});

const createNoteSchema = z.object({
  timeSec: z.number().min(0),
  text: z.string(),
  tags: z.array(z.string()).optional(),
});

const updateNoteSchema = z.object({
  text: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['open', 'promoted', 'discarded']).optional(),
  timeSec: z.number().min(0).optional(),
});

const reviewSchema = z.object({
  reviewStatus: z.enum(['unreviewed', 'in_progress', 'reviewed']),
});

const watchedSchema = z.object({
  ranges: z.array(z.object({ start: z.number(), end: z.number() })),
});

function sendError(reply: FastifyReply, status: number, message: string): void {
  void reply.status(status).send({ error: message });
}

export interface RouteDeps {
  config: Config;
  store: ProjectStore;
  queue: JobQueue;
  coordinator: JobCoordinator;
}

/** shared の apiPaths が定義する全エンドポイントを登録 */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, store, queue, coordinator } = deps;

  // GET /api/health
  app.get(apiPaths.health(), async () => ({ status: 'ok' }));

  // GET /api/project
  app.get(apiPaths.project(), async (): Promise<ProjectResponse> => ({
    project: store.getState(),
  }));

  // PUT /api/project/settings
  app.put(apiPaths.settings(), async (req, reply): Promise<ProjectResponse | void> => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    store.updateSettings(parsed.data.settings);
    return { project: store.getState() };
  });

  // POST /api/scan
  app.post(apiPaths.scan(), async (req, reply): Promise<ScanResponse | void> => {
    const parsed = scanSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    const roots = parsed.data.mediaRoots ?? store.getSettings().mediaRoots;
    if (parsed.data.mediaRoots) {
      store.updateSettings({ mediaRoots: parsed.data.mediaRoots });
    }
    if (roots.length === 0) {
      return sendError(reply, 400, 'mediaRoots が未設定です');
    }
    const jobId = coordinator.enqueueScan(roots);
    return { jobId };
  });

  // GET /api/jobs
  app.get(apiPaths.jobs(), async (): Promise<JobsResponse> => ({ jobs: queue.list() }));

  // POST /api/jobs/enqueue
  app.post(apiPaths.enqueue(), async (req, reply): Promise<EnqueueResponse | void> => {
    const parsed = enqueueSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    const clips = parsed.data.clipIds
      ? parsed.data.clipIds.map((id) => store.getClip(id)).filter((c) => c !== undefined)
      : store.getAllClips();
    const jobIds = coordinator.enqueueAnalysis(parsed.data.type, clips);
    return { jobIds };
  });

  // POST /api/clips/:clipId/notes
  app.post<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/notes',
    async (req, reply): Promise<NoteResponse | void> => {
      const clip = store.getClip(req.params.clipId);
      if (!clip) return sendError(reply, 404, 'clip not found');
      const parsed = createNoteSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const note = store.createNote(
        req.params.clipId,
        parsed.data.timeSec,
        parsed.data.text,
        parsed.data.tags ?? [],
      );
      return { note };
    },
  );

  // PATCH /api/notes/:noteId
  app.patch<{ Params: { noteId: string } }>(
    '/api/notes/:noteId',
    async (req, reply): Promise<NoteResponse | void> => {
      const parsed = updateNoteSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const note = store.updateNote(req.params.noteId, parsed.data);
      if (!note) return sendError(reply, 404, 'note not found');
      return { note };
    },
  );

  // DELETE /api/notes/:noteId
  app.delete<{ Params: { noteId: string } }>(
    '/api/notes/:noteId',
    async (req, reply): Promise<void> => {
      const ok = store.deleteNote(req.params.noteId);
      if (!ok) return sendError(reply, 404, 'note not found');
      void reply.status(204).send();
    },
  );

  // PATCH /api/clips/:clipId/review
  app.patch<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/review',
    async (req, reply): Promise<ClipResponse | void> => {
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const clip = store.setReviewStatus(req.params.clipId, parsed.data.reviewStatus);
      if (!clip) return sendError(reply, 404, 'clip not found');
      return { clip };
    },
  );

  // POST /api/clips/:clipId/watched
  app.post<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/watched',
    async (req, reply): Promise<ClipResponse | void> => {
      const parsed = watchedSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const clip = store.addWatchedRanges(req.params.clipId, parsed.data.ranges);
      if (!clip) return sendError(reply, 404, 'clip not found');
      return { clip };
    },
  );

  // GET /api/clips/:clipId/thumbs
  app.get<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/thumbs',
    async (req): Promise<ThumbsResponse> => {
      const manifest = await buildThumbManifest(config, req.params.clipId);
      return { manifest };
    },
  );

  // GET /api/thumbs/:clipId/:interval/:time.jpg
  app.get<{ Params: { clipId: string; interval: string; timeFile: string } }>(
    '/api/thumbs/:clipId/:interval/:timeFile',
    async (req, reply): Promise<void> => {
      const { clipId, interval, timeFile } = req.params;
      // パストラバーサル対策: 各セグメントを厳格にバリデーション
      if (!/^[a-f0-9]{1,64}$/.test(clipId)) return sendError(reply, 400, 'invalid clipId');
      const intervalNum = Number(interval);
      if (!Number.isInteger(intervalNum) || intervalNum <= 0) {
        return sendError(reply, 400, 'invalid interval');
      }
      const m = timeFile.match(/^(\d+)\.jpg$/);
      if (!m) return sendError(reply, 400, 'invalid time');
      const timeSec = Number(m[1]);
      const filePath = thumbFilePath(config, clipId, intervalNum, timeSec);
      // 念のため canonical パスがキャッシュ配下か確認
      const base = path.resolve(config.thumbsDir);
      if (!path.resolve(filePath).startsWith(base + path.sep)) {
        return sendError(reply, 400, 'invalid path');
      }
      try {
        const buf = await fsp.readFile(filePath);
        void reply.header('Content-Type', 'image/jpeg').send(buf);
      } catch {
        sendError(reply, 404, 'thumb not found');
      }
    },
  );

  // GET /api/clips/:clipId/vad
  app.get<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/vad',
    async (req, reply): Promise<VadResponse | void> => {
      const vad = await readVadResult(config, req.params.clipId);
      if (!vad) return sendError(reply, 404, 'vad not generated');
      return { vad };
    },
  );

  // GET /api/media/:fileId
  app.get<{ Params: { fileId: string } }>(
    '/api/media/:fileId',
    async (req, reply): Promise<void> => {
      const resolved = store.resolveFile(req.params.fileId);
      if (!resolved) return sendError(reply, 404, 'file not found');
      let size: number;
      try {
        const stat = await fsp.stat(resolved.path);
        size = stat.size;
      } catch {
        return sendError(reply, 404, 'file unavailable');
      }
      const range = req.headers.range;
      const res = buildMediaResponse(resolved.path, size, range);
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
}
