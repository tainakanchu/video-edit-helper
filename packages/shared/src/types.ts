export type ID = string;

/** 秒単位の区間。クリップの「通しタイムコード」基準 */
export interface TimeRange {
  start: number;
  end: number;
}

export interface SourceFile {
  id: ID;
  /** 絶対パス(Windows / POSIX どちらもありうる) */
  path: string;
  fileName: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  fps: number | null;
  /** コンテナメタデータの creation_time(ISO)。無ければ null */
  createdAt: string | null;
  /** ファイルシステムの mtime(ISO)。createdAt のフォールバック */
  mtime: string;
  /** 論理クリップ内での開始オフセット(秒) */
  startOffsetSec: number;
  /** ブラウザで直接再生できる見込みか(H.264 等) */
  playableInBrowser: boolean;
  /** 軽量プロキシ(H.264)が生成済みか(playableInBrowser=false の素材用) */
  proxyAvailable?: boolean;
  /** 撮影位置(コンテナの location タグ ISO6709 から抽出)。無ければ null */
  gps?: GpsPoint | null;
}

/** 撮影位置(度) */
export interface GpsPoint {
  lat: number;
  lon: number;
}

export type ReviewStatus = 'unreviewed' | 'in_progress' | 'reviewed';
export type NoteStatus = 'open' | 'promoted' | 'discarded';

/** 付箋メモ(1点打ち)。Phase 2 で Selection への昇格元になる */
export interface Note {
  id: ID;
  clipId: ID;
  /** クリップ通しタイムコード(秒) */
  timeSec: number;
  text: string;
  tags: string[];
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
}

/** 論理クリップ。連番分割された実ファイル群を 1 本として扱う */
export interface Clip {
  id: ID;
  dayId: ID;
  name: string;
  /** メディアルート直下のサブフォルダ名等から推定したカメララベル */
  cameraLabel: string;
  /** startOffsetSec 昇順 */
  files: SourceFile[];
  durationSec: number;
  /** 撮影開始時刻(ISO)。日別振り分けと並び順に使用 */
  recordedAt: string;
  reviewStatus: ReviewStatus;
  /** 再生済み区間(正規化済み・昇順) */
  watchedRanges: TimeRange[];
  /** 代表撮影位置(GPS を持つ最初のファイルのもの)。無ければ null */
  gps?: GpsPoint | null;
}

export interface Day {
  /** 'YYYY-MM-DD'(dayStartHour 補正後) */
  id: ID;
  date: string;
  /** Day 1..N の通し番号(日付昇順) */
  index: number;
  /** recordedAt 昇順(全カメラ混在) */
  clipIds: ID[];
}

export interface ProjectSettings {
  mediaRoots: string[];
  /** この時刻(時)より前の撮影は前日扱いにする(深夜素材対策) */
  dayStartHour: number;
  thumbCoarseIntervalSec: number;
  thumbFineIntervalSec: number;
  /** true なら再生可能な素材(4K 等)も含め全ファイルのプロキシを生成する */
  proxyAllFiles: boolean;
}

/** 選定範囲(Phase 2)。付箋からの昇格またはイン/アウト点打ちで作成 */
export interface Selection {
  id: ID;
  clipId: ID;
  /** クリップ通しタイムコード(秒) */
  inSec: number;
  outSec: number;
  text: string;
  tags: string[];
  /** ★評価 0〜3 */
  rating: 0 | 1 | 2 | 3;
  /** 昇格元の付箋(あれば)。Selection 削除時に open へ戻す */
  noteId: ID | null;
  /** ラフカット内の手動並び順(null は時系列順) */
  orderKey: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectState {
  version: 1;
  settings: ProjectSettings;
  days: Day[];
  clips: Record<ID, Clip>;
  notes: Record<ID, Note>;
  /** Phase 2 で追加。旧データはロード時に {} で初期化 */
  selections: Record<ID, Selection>;
}

export type JobType =
  | 'scan'
  | 'thumbs-coarse'
  | 'thumbs-fine'
  | 'vad'
  | 'proxy'
  | 'scenes'
  | 'whisper';
export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled';

export interface JobInfo {
  id: ID;
  type: JobType;
  clipId?: ID;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export type VadProviderName = 'silero' | 'silencedetect';

export interface VadResult {
  clipId: ID;
  provider: VadProviderName;
  /** 発話(音声活動)区間。クリップ通しタイムコード・正規化済み昇順 */
  segments: TimeRange[];
  generatedAt: string;
}

export interface ThumbManifest {
  clipId: ID;
  /** interval(秒)の文字列キー → 生成済みフレーム時刻(秒)昇順 */
  intervals: Record<string, number[]>;
}

/** 文字起こしの 1 セグメント(クリップ通しタイムコード) */
export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  clipId: ID;
  /** 使用モデル(例: ggml-small) */
  model: string;
  segments: TranscriptSegment[];
  generatedAt: string;
}

/** 横断検索のヒット種別 */
export type SearchResultKind = 'note' | 'selection' | 'transcript';

export interface SearchResultItem {
  kind: SearchResultKind;
  clipId: ID;
  dayId: ID;
  clipName: string;
  /** ジャンプ先(クリップ通しタイムコード) */
  timeSec: number;
  endSec?: number;
  /** ヒットしたテキスト(前後スニペット込み) */
  text: string;
}

/** ラフカット等の書き出し形式 */
export type ExportFormat = 'fcpxml' | 'csv' | 'md';

/** シーン自動分割の結果(場面転換点。クリップ通しタイムコード昇順) */
export interface SceneList {
  clipId: ID;
  times: number[];
  generatedAt: string;
}
