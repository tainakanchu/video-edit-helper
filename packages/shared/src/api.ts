import type {
  Clip,
  ExportFormat,
  ID,
  JobInfo,
  JobType,
  Note,
  NoteStatus,
  ProjectSettings,
  ProjectState,
  ReviewStatus,
  SceneList,
  SearchResultItem,
  Selection,
  ThumbManifest,
  TimeRange,
  Transcript,
  VadResult,
} from './types.js';
import type {
  EdlComment,
  EdlSource,
  EdlTimeline,
  PathRewrite,
} from './edl.js';

export const SERVER_PORT_DEFAULT = 4810;

export const defaultSettings: ProjectSettings = {
  mediaRoots: [],
  dayStartHour: 4,
  thumbCoarseIntervalSec: 60,
  thumbFineIntervalSec: 10,
  proxyAllFiles: false,
  cameraTimeOffsets: {},
  rootTimeOffsets: {},
  edlSources: [],
  activeEdlId: null,
  pathRewrites: [],
  wslDistro: '',
};

/**
 * REST API のパス定義。server のルート定義と web のクライアントは
 * 必ずここを経由して、文字列の食い違いを防ぐ。
 */
export const apiPaths = {
  health: () => `/api/health`,
  /** GET → MountsResponse / PUT { root, localPath } → MountsResponse(cross-OS のマシン別パス対応) */
  mounts: () => `/api/mounts`,
  /** GET → ProjectResponse */
  project: () => `/api/project`,
  /** PUT UpdateSettingsRequest → ProjectResponse */
  settings: () => `/api/project/settings`,
  /** POST ScanRequest → ScanResponse(スキャンジョブ開始) */
  scan: () => `/api/scan`,
  /** GET → JobsResponse */
  jobs: () => `/api/jobs`,
  /** GET → AnalysisStatusResponse(クリップごとの解析到達度) */
  analysisStatus: () => `/api/analysis-status`,
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
  /** GET → video/mp4(軽量プロキシ。Range 対応。未生成は 404) */
  mediaProxy: (fileId: ID) => `/api/media/${fileId}/proxy`,
  /** POST CreateSelectionRequest → SelectionResponse */
  clipSelections: (clipId: ID) => `/api/clips/${clipId}/selections`,
  /** PATCH UpdateSelectionRequest → SelectionResponse / DELETE → 204(昇格元付箋は open に戻す) */
  selection: (selectionId: ID) => `/api/selections/${selectionId}`,
  /** GET ?format=fcpxml|csv|md → ファイルダウンロード(Day のラフカット書き出し) */
  dayExport: (dayId: ID, format: ExportFormat) => `/api/days/${dayId}/export?format=${format}`,
  /** GET → TranscriptResponse(未生成は 404) */
  clipTranscript: (clipId: ID) => `/api/clips/${clipId}/transcript`,
  /** GET → ScenesResponse(未生成は 404) */
  clipScenes: (clipId: ID) => `/api/clips/${clipId}/scenes`,
  /** GET ?q=... → SearchResponse(メモ・選定・文字起こしの横断検索) */
  search: (query: string) => `/api/search?q=${encodeURIComponent(query)}`,
  /** GET → EdlSourcesResponse / POST AddEdlRequest → EdlSourcesResponse */
  edls: () => `/api/edl`,
  /** POST ActivateEdlRequest → EdlSourcesResponse */
  edlActive: () => `/api/edl/active`,
  /** PUT UpdatePathRewritesRequest → EdlSourcesResponse */
  edlPathRewrites: () => `/api/edl/path-rewrites`,
  /** PATCH UpdateEdlRequest → EdlSourcesResponse / DELETE → EdlSourcesResponse */
  edlItem: (id: ID) => `/api/edl/${encodeURIComponent(id)}`,
  /** GET → EdlTimelineResponse */
  edlTimeline: (id: ID) => `/api/edl/${encodeURIComponent(id)}/timeline`,
  /**
   * GET。Range 対応の素材配信。
   * role は segment | source | image | realaudio | music。key は区間 id など（生パスは渡さない）。
   */
  edlAsset: (id: ID, role: string, key: string) =>
    `/api/edl/${encodeURIComponent(id)}/asset/${encodeURIComponent(role)}/${encodeURIComponent(key)}`,
  /** GET → EdlCommentsResponse / POST CreateEdlCommentRequest → EdlCommentResponse */
  edlComments: (id: ID) => `/api/edl/${encodeURIComponent(id)}/comments`,
  /** DELETE → 204 */
  edlComment: (id: ID, commentId: ID) =>
    `/api/edl/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
} as const;

export interface AddEdlRequest {
  path: string;
  cacheDir?: string;
  label?: string;
}

export interface UpdateEdlRequest {
  label?: string;
  cacheDir?: string;
}

export interface ActivateEdlRequest {
  id: string | null;
}

export interface EdlSourcesResponse {
  sources: EdlSource[];
  activeEdlId: string | null;
  pathRewrites: PathRewrite[];
  wslDistro: string;
}

export interface UpdatePathRewritesRequest {
  pathRewrites: PathRewrite[];
  wslDistro?: string;
}

export interface EdlTimelineResponse {
  timeline: EdlTimeline;
}

export interface CreateEdlCommentRequest {
  segmentId: string;
  timeSec: number;
  text: string;
}

export interface EdlCommentsResponse {
  comments: EdlComment[];
}

export interface EdlCommentResponse {
  comment: EdlComment;
}

export interface ProjectResponse {
  project: ProjectState;
}

/** cross-OS: 素材ルートと「このマシンでの実パス」の対応。localPath 未設定は null */
export interface MountRootInfo {
  root: string;
  localPath: string | null;
}

export interface MountsResponse {
  roots: MountRootInfo[];
}

export interface SetMountRequest {
  root: string;
  /** このマシンでの実パス。空文字で対応を解除 */
  localPath: string;
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

/** クリップ1本の解析到達度(各解析が完了しているか) */
export interface ClipAnalysisStatus {
  clipId: ID;
  thumbsCoarse: boolean;
  thumbsFine: boolean;
  vad: boolean;
  proxy: boolean;
  scenes: boolean;
  transcript: boolean;
}

export interface AnalysisStatusResponse {
  clips: ClipAnalysisStatus[];
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

export interface CreateSelectionRequest {
  inSec: number;
  outSec: number;
  text?: string;
  tags?: string[];
  rating?: 0 | 1 | 2 | 3;
  /** 付箋からの昇格時に指定。該当付箋を promoted に更新する */
  noteId?: ID;
}

export interface UpdateSelectionRequest {
  inSec?: number;
  outSec?: number;
  text?: string;
  tags?: string[];
  rating?: 0 | 1 | 2 | 3;
  orderKey?: number | null;
}

export interface SelectionResponse {
  selection: Selection;
}

export interface TranscriptResponse {
  transcript: Transcript;
}

export interface ScenesResponse {
  scenes: SceneList;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
}

export interface ErrorResponse {
  error: string;
}
