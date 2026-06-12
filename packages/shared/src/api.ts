import type {
  Clip,
  ID,
  JobInfo,
  JobType,
  Note,
  NoteStatus,
  ProjectSettings,
  ProjectState,
  ReviewStatus,
  ThumbManifest,
  TimeRange,
  VadResult,
} from './types.js';

export const SERVER_PORT_DEFAULT = 4810;

export const defaultSettings: ProjectSettings = {
  mediaRoots: [],
  dayStartHour: 4,
  thumbCoarseIntervalSec: 60,
  thumbFineIntervalSec: 10,
};

/**
 * REST API のパス定義。server のルート定義と web のクライアントは
 * 必ずここを経由して、文字列の食い違いを防ぐ。
 */
export const apiPaths = {
  health: () => `/api/health`,
  /** GET → ProjectResponse */
  project: () => `/api/project`,
  /** PUT UpdateSettingsRequest → ProjectResponse */
  settings: () => `/api/project/settings`,
  /** POST ScanRequest → ScanResponse(スキャンジョブ開始) */
  scan: () => `/api/scan`,
  /** GET → JobsResponse */
  jobs: () => `/api/jobs`,
  /** POST EnqueueRequest → EnqueueResponse(解析ジョブの手動投入/再実行) */
  enqueue: () => `/api/jobs/enqueue`,
  /** POST CreateNoteRequest → NoteResponse */
  clipNotes: (clipId: ID) => `/api/clips/${clipId}/notes`,
  /** PATCH UpdateNoteRequest → NoteResponse / DELETE → 204 */
  note: (noteId: ID) => `/api/notes/${noteId}`,
  /** PATCH UpdateReviewRequest → ClipResponse */
  clipReview: (clipId: ID) => `/api/clips/${clipId}/review`,
  /** POST AddWatchedRequest → ClipResponse(サーバー側でマージ) */
  clipWatched: (clipId: ID) => `/api/clips/${clipId}/watched`,
  /** GET → ThumbsResponse */
  clipThumbs: (clipId: ID) => `/api/clips/${clipId}/thumbs`,
  /** GET → image/jpeg */
  thumbImage: (clipId: ID, intervalSec: number, timeSec: number) =>
    `/api/thumbs/${clipId}/${intervalSec}/${timeSec}.jpg`,
  /** GET → VadResponse(未生成は 404) */
  clipVad: (clipId: ID) => `/api/clips/${clipId}/vad`,
  /** GET → video/mp4(Range 対応ストリーミング) */
  media: (fileId: ID) => `/api/media/${fileId}`,
} as const;

export interface ProjectResponse {
  project: ProjectState;
}

export interface UpdateSettingsRequest {
  settings: Partial<ProjectSettings>;
}

export interface ScanRequest {
  /** 省略時は settings.mediaRoots を使う */
  mediaRoots?: string[];
}

export interface ScanResponse {
  jobId: ID;
}

export interface JobsResponse {
  jobs: JobInfo[];
}

export interface EnqueueRequest {
  type: Exclude<JobType, 'scan'>;
  /** 省略時は全クリップ対象 */
  clipIds?: ID[];
}

export interface EnqueueResponse {
  jobIds: ID[];
}

export interface CreateNoteRequest {
  timeSec: number;
  text: string;
  tags?: string[];
}

export interface UpdateNoteRequest {
  text?: string;
  tags?: string[];
  status?: NoteStatus;
  timeSec?: number;
}

export interface NoteResponse {
  note: Note;
}

export interface UpdateReviewRequest {
  reviewStatus: ReviewStatus;
}

export interface AddWatchedRequest {
  ranges: TimeRange[];
}

export interface ClipResponse {
  clip: Clip;
}

export interface ThumbsResponse {
  manifest: ThumbManifest;
}

export interface VadResponse {
  vad: VadResult;
}

export interface ErrorResponse {
  error: string;
}
