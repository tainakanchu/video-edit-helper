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
}

export interface ProjectState {
  version: 1;
  settings: ProjectSettings;
  days: Day[];
  clips: Record<ID, Clip>;
  notes: Record<ID, Note>;
}

export type JobType = 'scan' | 'thumbs-coarse' | 'thumbs-fine' | 'vad';
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
