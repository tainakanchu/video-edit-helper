import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  apiPaths,
  type AnalysisStatusResponse,
  type ClipResponse,
  type EnqueueResponse,
  type ExportFormat,
  type JobsResponse,
  type MountsResponse,
  type NoteResponse,
  type ProjectResponse,
  type ScanResponse,
  type ScenesResponse,
  type SearchResponse,
  type SelectionResponse,
  type ThumbsResponse,
  type TranscriptResponse,
  type VadResponse,
} from '@veh/shared';
import type { Config } from '../config.js';
import type { ProjectStore } from '../store/projectStore.js';
import type { JobQueue } from '../jobs/queue.js';
import { buildThumbManifest, thumbFilePath } from '../jobs/thumbnails.js';
import { readVadResult } from '../jobs/vad.js';
import { hasProxy, proxyFilePath } from '../jobs/proxy.js';
import { readScenes } from '../jobs/scenes.js';
import { readTranscript } from '../jobs/whisper.js';
import { buildMediaResponse } from '../media/stream.js';
import { renderExport } from '../export/index.js';
import { searchAll } from '../search/matcher.js';
import type { TranscriptCache } from '../search/transcriptCache.js';
import type { JobCoordinator } from '../jobs/coordinator.js';
import type { MountStore } from '../media/mounts.js';

const settingsSchema = z.object({
  settings: z
    .object({
      mediaRoots: z.array(z.string()).optional(),
      dayStartHour: z.number().int().min(0).max(23).optional(),
      thumbCoarseIntervalSec: z.number().positive().optional(),
      thumbFineIntervalSec: z.number().positive().optional(),
      proxyAllFiles: z.boolean().optional(),
      // cameraLabel → 補正分(符号付き整数)。±24h を上限にガード
      cameraTimeOffsets: z.record(z.string(), z.number().int().min(-1440).max(1440)).optional(),
      // 素材ルート(mediaRoots の要素)→ 補正分(符号付き整数)。±24h を上限にガード
      rootTimeOffsets: z.record(z.string(), z.number().int().min(-1440).max(1440)).optional(),
    })
    .strict(),
});

const scanSchema = z.object({
  mediaRoots: z.array(z.string()).optional(),
});

const mountSchema = z.object({
  root: z.string(),
  localPath: z.string(),
});

const enqueueSchema = z.object({
  type: z.enum(['thumbs-coarse', 'thumbs-fine', 'vad', 'proxy', 'scenes', 'whisper']),
  clipIds: z.array(z.string()).optional(),
});

const ratingSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

const createSelectionSchema = z
  .object({
    inSec: z.number().min(0),
    outSec: z.number().min(0),
    text: z.string().optional(),
    tags: z.array(z.string()).optional(),
    rating: ratingSchema.optional(),
    noteId: z.string().optional(),
  })
  .refine((d) => d.inSec < d.outSec, { message: 'inSec は outSec より小さくしてください' });

const updateSelectionSchema = z
  .object({
    inSec: z.number().min(0).optional(),
    outSec: z.number().min(0).optional(),
    text: z.string().optional(),
    tags: z.array(z.string()).optional(),
    rating: ratingSchema.optional(),
    orderKey: z.number().nullable().optional(),
  })
  .refine((d) => d.inSec === undefined || d.outSec === undefined || d.inSec < d.outSec, {
    message: 'inSec は outSec より小さくしてください',
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
  transcriptCache: TranscriptCache;
  /** cross-OS: 保存済みパスをこのマシンの実パスへ解決する対応表 */
  mounts: MountStore;
}

/** clipId → 所属 Day を引く(検索結果や書き出しの dayId 解決用) */
function findDayIdForClip(store: ProjectStore, clipId: string): string | undefined {
  const clip = store.getClip(clipId);
  if (clip) return clip.dayId;
  for (const day of store.getState().days) {
    if (day.clipIds.includes(clipId)) return day.id;
  }
  return undefined;
}

/** shared の apiPaths が定義する全エンドポイントを登録 */
export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, store, queue, coordinator, transcriptCache, mounts } = deps;

  // GET /api/health
  app.get(apiPaths.health(), async () => ({ status: 'ok' }));

  // GET /api/mounts — 素材ルートと「このマシンでの実パス」の対応(cross-OS)
  app.get(apiPaths.mounts(), async (): Promise<MountsResponse> => {
    const map = mounts.getAll();
    const roots = store.getSettings().mediaRoots.map((root) => ({
      root,
      localPath: map[root] ?? null,
    }));
    return { roots };
  });

  // PUT /api/mounts — ルートに対するこのマシンの実パスを設定(空で解除)
  app.put(apiPaths.mounts(), async (req, reply): Promise<MountsResponse | void> => {
    const parsed = mountSchema.safeParse(req.body ?? {});
    if (!parsed.success) return sendError(reply, 400, '不正なリクエストです');
    mounts.set(parsed.data.root, parsed.data.localPath);
    const map = mounts.getAll();
    const roots = store.getSettings().mediaRoots.map((root) => ({
      root,
      localPath: map[root] ?? null,
    }));
    return { roots };
  });

  // GET /api/project
  app.get(apiPaths.project(), async (): Promise<ProjectResponse> => ({
    project: store.getState(),
  }));

  // PUT /api/project/settings
  app.put(apiPaths.settings(), async (req, reply): Promise<ProjectResponse | void> => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, parsed.error.message);
    const { settings } = parsed.data;
    store.updateSettings(settings);
    // 時刻補正系の設定変更は再スキャン不要で即時反映する
    if ('cameraTimeOffsets' in settings || 'rootTimeOffsets' in settings || 'dayStartHour' in settings) {
      store.reapplyTimeSettings();
    }
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

  // GET /api/analysis-status — クリップごとの解析到達度
  app.get(
    apiPaths.analysisStatus(),
    async (): Promise<AnalysisStatusResponse> => ({ clips: coordinator.getAnalysisStatus() }),
  );

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
      // 保存済みパスをこのマシンの実パスへ解決(別 OS で開いた場合の cross-OS 対応)
      const mediaPath = mounts.resolve(resolved.path, store.getSettings().mediaRoots);
      let size: number;
      try {
        const stat = await fsp.stat(mediaPath);
        size = stat.size;
      } catch {
        return sendError(reply, 404, 'file unavailable');
      }
      const range = req.headers.range;
      const res = buildMediaResponse(mediaPath, size, range);
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

  // GET /api/media/:fileId/proxy(軽量プロキシ。常に video/mp4・Range 対応)
  app.get<{ Params: { fileId: string } }>(
    '/api/media/:fileId/proxy',
    async (req, reply): Promise<void> => {
      const fileId = req.params.fileId;
      // 存在するファイルか確認(未知 fileId は 404)
      if (!store.resolveFile(fileId)) return sendError(reply, 404, 'file not found');
      if (!hasProxy(config, fileId)) return sendError(reply, 404, 'proxy not generated');
      const proxyPath = proxyFilePath(config, fileId);
      let size: number;
      try {
        const stat = await fsp.stat(proxyPath);
        size = stat.size;
      } catch {
        return sendError(reply, 404, 'proxy unavailable');
      }
      const res = buildMediaResponse(proxyPath, size, req.headers.range);
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

  // POST /api/clips/:clipId/selections
  app.post<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/selections',
    async (req, reply): Promise<SelectionResponse | void> => {
      const clip = store.getClip(req.params.clipId);
      if (!clip) return sendError(reply, 404, 'clip not found');
      const parsed = createSelectionSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      const selection = store.createSelection(req.params.clipId, parsed.data);
      return { selection };
    },
  );

  // PATCH /api/selections/:selectionId
  app.patch<{ Params: { selectionId: string } }>(
    '/api/selections/:selectionId',
    async (req, reply): Promise<SelectionResponse | void> => {
      const parsed = updateSelectionSchema.safeParse(req.body);
      if (!parsed.success) return sendError(reply, 400, parsed.error.message);
      // 片方だけの更新でも結果として in < out になることを保証する
      const existing = store.getSelection(req.params.selectionId);
      if (!existing) return sendError(reply, 404, 'selection not found');
      const nextIn = parsed.data.inSec ?? existing.inSec;
      const nextOut = parsed.data.outSec ?? existing.outSec;
      if (nextIn >= nextOut) {
        return sendError(reply, 400, 'inSec は outSec より小さくしてください');
      }
      const selection = store.updateSelection(req.params.selectionId, parsed.data);
      if (!selection) return sendError(reply, 404, 'selection not found');
      return { selection };
    },
  );

  // DELETE /api/selections/:selectionId(昇格元付箋は open に戻す)
  app.delete<{ Params: { selectionId: string } }>(
    '/api/selections/:selectionId',
    async (req, reply): Promise<void> => {
      const ok = store.deleteSelection(req.params.selectionId);
      if (!ok) return sendError(reply, 404, 'selection not found');
      void reply.status(204).send();
    },
  );

  // GET /api/days/:dayId/export?format=fcpxml|csv|md
  app.get<{ Params: { dayId: string }; Querystring: { format?: string } }>(
    '/api/days/:dayId/export',
    async (req, reply): Promise<void> => {
      const format = req.query.format;
      if (format !== 'fcpxml' && format !== 'csv' && format !== 'md') {
        return sendError(reply, 400, 'format は fcpxml / csv / md のいずれかを指定してください');
      }
      const day = store.getState().days.find((d) => d.id === req.params.dayId);
      if (!day) return sendError(reply, 404, 'day not found');
      // Day 内クリップに属する Selection を集める
      const clipIdSet = new Set(day.clipIds);
      const selections = store
        .getAllSelections()
        .filter((s) => clipIdSet.has(s.clipId));
      if (selections.length === 0) {
        return sendError(reply, 400, 'この Day には選定範囲がありません');
      }
      const out = renderExport(
        format as ExportFormat,
        selections,
        // 保存済みパスをこのマシンの実パスへ解決してから埋め込む(別 OS で開いた場合の cross-OS 対応)
        (id) => {
          const clip = store.getClip(id);
          return clip ? mounts.resolveClip(clip, store.getSettings().mediaRoots) : undefined;
        },
        day.date,
      );
      const fileName = `roughcut-${day.date}.${out.fileExt}`;
      void reply
        .header('Content-Type', out.contentType)
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .send(out.body);
    },
  );

  // GET /api/clips/:clipId/transcript
  app.get<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/transcript',
    async (req, reply): Promise<TranscriptResponse | void> => {
      const transcript = await readTranscript(config, req.params.clipId);
      if (!transcript) return sendError(reply, 404, 'transcript not generated');
      return { transcript };
    },
  );

  // GET /api/clips/:clipId/scenes
  app.get<{ Params: { clipId: string } }>(
    '/api/clips/:clipId/scenes',
    async (req, reply): Promise<ScenesResponse | void> => {
      const scenes = await readScenes(config, req.params.clipId);
      if (!scenes) return sendError(reply, 404, 'scenes not generated');
      return { scenes };
    },
  );

  // GET /api/search?q=...
  app.get<{ Querystring: { q?: string } }>(
    '/api/search',
    async (req, reply): Promise<SearchResponse | void> => {
      const q = (req.query.q ?? '').trim();
      if (q === '') return sendError(reply, 400, 'q は必須です');

      const state = store.getState();
      const notes = Object.values(state.notes);
      const selections = store.getAllSelections();
      // 全クリップの Transcript をキャッシュ経由で遅延ロード
      const transcripts: { clipId: string; segments: { start: number; end: number; text: string }[] }[] =
        [];
      for (const clip of store.getAllClips()) {
        const t = await transcriptCache.get(clip.id);
        if (t && t.segments.length > 0) {
          transcripts.push({ clipId: clip.id, segments: t.segments });
        }
      }
      const results = searchAll({
        query: q,
        notes,
        selections,
        transcripts,
        clipMeta: (clipId) => {
          const clip = store.getClip(clipId);
          if (!clip) return undefined;
          const dayId = findDayIdForClip(store, clipId) ?? clip.dayId;
          return { dayId, clipName: clip.name };
        },
      });
      return { query: q, results };
    },
  );
}
