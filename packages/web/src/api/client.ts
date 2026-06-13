import {
  apiPaths,
  type AddWatchedRequest,
  type ClipResponse,
  type CreateNoteRequest,
  type CreateSelectionRequest,
  type EnqueueRequest,
  type EnqueueResponse,
  type ID,
  type JobsResponse,
  type NoteResponse,
  type ProjectResponse,
  type ReviewStatus,
  type ScanRequest,
  type ScanResponse,
  type ScenesResponse,
  type SearchResponse,
  type SelectionResponse,
  type ThumbsResponse,
  type TranscriptResponse,
  type UpdateNoteRequest,
  type UpdateSelectionRequest,
  type UpdateSettingsRequest,
  type VadResponse,
} from '@veh/shared';

/** API 由来のエラー。message は日本語で UI 表示に使える */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 404 を null として扱う(VAD など未生成リソース向け) */
  allow404?: boolean;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, allow404 = false } = opts;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('サーバーに接続できませんでした', 0);
  }

  if (allow404 && res.status === 404) {
    return null as T;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  if (!res.ok) {
    let message = `リクエストに失敗しました (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data && typeof data.error === 'string') message = data.error;
    } catch {
      // ボディが JSON でない場合は既定メッセージのまま
    }
    throw new ApiError(message, res.status);
  }

  // 本文が空の可能性に備える
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  getProject: () => request<ProjectResponse>(apiPaths.project()),

  updateSettings: (req: UpdateSettingsRequest) =>
    request<ProjectResponse>(apiPaths.settings(), { method: 'PUT', body: req }),

  startScan: (req: ScanRequest = {}) =>
    request<ScanResponse>(apiPaths.scan(), { method: 'POST', body: req }),

  getJobs: () => request<JobsResponse>(apiPaths.jobs()),

  enqueue: (req: EnqueueRequest) =>
    request<EnqueueResponse>(apiPaths.enqueue(), { method: 'POST', body: req }),

  createNote: (clipId: ID, req: CreateNoteRequest) =>
    request<NoteResponse>(apiPaths.clipNotes(clipId), { method: 'POST', body: req }),

  updateNote: (noteId: ID, req: UpdateNoteRequest) =>
    request<NoteResponse>(apiPaths.note(noteId), { method: 'PATCH', body: req }),

  deleteNote: (noteId: ID) =>
    request<void>(apiPaths.note(noteId), { method: 'DELETE' }),

  setReview: (clipId: ID, reviewStatus: ReviewStatus) =>
    request<ClipResponse>(apiPaths.clipReview(clipId), {
      method: 'PATCH',
      body: { reviewStatus },
    }),

  addWatched: (clipId: ID, req: AddWatchedRequest) =>
    request<ClipResponse>(apiPaths.clipWatched(clipId), { method: 'POST', body: req }),

  getThumbs: (clipId: ID) => request<ThumbsResponse>(apiPaths.clipThumbs(clipId)),

  getVad: (clipId: ID) =>
    request<VadResponse | null>(apiPaths.clipVad(clipId), { allow404: true }),

  createSelection: (clipId: ID, req: CreateSelectionRequest) =>
    request<SelectionResponse>(apiPaths.clipSelections(clipId), { method: 'POST', body: req }),

  updateSelection: (selectionId: ID, req: UpdateSelectionRequest) =>
    request<SelectionResponse>(apiPaths.selection(selectionId), { method: 'PATCH', body: req }),

  deleteSelection: (selectionId: ID) =>
    request<void>(apiPaths.selection(selectionId), { method: 'DELETE' }),

  getTranscript: (clipId: ID) =>
    request<TranscriptResponse | null>(apiPaths.clipTranscript(clipId), { allow404: true }),

  getScenes: (clipId: ID) =>
    request<ScenesResponse | null>(apiPaths.clipScenes(clipId), { allow404: true }),

  search: (query: string) => request<SearchResponse>(apiPaths.search(query)),
};

/** メディア / サムネイル画像 URL(<video> や <img> の src に直接渡す) */
export const mediaUrl = (fileId: ID) => apiPaths.media(fileId);
export const proxyUrl = (fileId: ID) => apiPaths.mediaProxy(fileId);
export const thumbUrl = (clipId: ID, intervalSec: number, timeSec: number) =>
  apiPaths.thumbImage(clipId, intervalSec, timeSec);
