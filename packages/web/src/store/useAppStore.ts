import {
  addRange,
  coverage,
  rangesTotal,
  type Clip,
  type CreateSelectionRequest,
  type ID,
  type JobInfo,
  type JobType,
  type Note,
  type ProjectSettings,
  type ProjectState,
  type ReviewStatus,
  type Selection,
  type TimeRange,
  type UpdateSelectionRequest,
} from '@veh/shared';
import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import { promotionWindow } from '../lib/selection';
import { clampGain } from '../lib/audio';

export interface Toast {
  id: number;
  message: string;
  kind: 'error' | 'info';
}

const REVIEW_CYCLE: ReviewStatus[] = ['unreviewed', 'in_progress', 'reviewed'];

interface AppState {
  // --- データ ---
  project: ProjectState | null;
  jobs: JobInfo[];
  loadingProject: boolean;
  toasts: Toast[];

  // --- 選択状態(URL から同期される派生値)---
  selectedDayId: ID | null;
  selectedClipId: ID | null;
  helpOpen: boolean;
  /** 再生可能素材でもプロキシを優先再生するか(4K 直再生が重い場合のため。既定 OFF) */
  preferProxy: boolean;
  /** プレビュー音量(ゲイン)。1.0 = 原音、最大 5.0(1.0 超は GainNode によるブースト) */
  audioGain: number;
  /** プレビュー音声のミュート状態(gain 0 相当) */
  audioMuted: boolean;
  /** 音声出力デバイス(setSinkId)の deviceId。空文字 = 既定デバイス */
  audioSinkId: string;
  /** 選定タブで強調表示したい行(昇格直後など)。一度読まれたら null に戻して良い */
  highlightSelectionId: ID | null;

  // --- ポーリング(内部) ---
  _jobTimer: ReturnType<typeof setInterval> | null;

  // --- アクション ---
  init: () => Promise<void>;
  refreshProject: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  startJobPolling: () => void;
  stopJobPolling: () => void;

  /** ルーターから呼ぶ: URL 由来の選択状態をストアへ反映 */
  setSelected: (sel: { dayId?: ID | null; clipId?: ID | null }) => void;
  setHighlightSelection: (selectionId: ID | null) => void;
  toggleHelp: (open?: boolean) => void;
  setPreferProxy: (on: boolean) => void;

  /** プレビュー音量(ゲイン)を 0〜5 にクランプして設定し localStorage に永続化 */
  setAudioGain: (gain: number) => void;
  /** プレビュー音声のミュートを切り替え(永続化) */
  toggleMute: () => void;
  /** 音声出力デバイスを設定(永続化) */
  setAudioSinkId: (id: string) => void;

  saveSettings: (settings: Partial<ProjectSettings>) => Promise<void>;
  startScan: (mediaRoots?: string[]) => Promise<void>;
  enqueue: (type: Exclude<JobType, 'scan'>, clipIds?: ID[]) => Promise<void>;

  cycleReview: (clipId: ID) => Promise<void>;
  setReview: (clipId: ID, status: ReviewStatus) => Promise<void>;
  pushWatched: (clipId: ID, ranges: TimeRange[]) => Promise<void>;
  mergeWatchedLocal: (clipId: ID, ranges: TimeRange[]) => void;

  addNote: (clipId: ID, timeSec: number, text: string, tags: string[]) => Promise<Note | null>;
  updateNote: (
    noteId: ID,
    patch: { text?: string; tags?: string[]; status?: Note['status']; timeSec?: number },
  ) => Promise<void>;
  deleteNote: (noteId: ID) => Promise<void>;

  // --- 選定(Selection)---
  createSelection: (clipId: ID, req: CreateSelectionRequest) => Promise<Selection | null>;
  updateSelection: (selectionId: ID, patch: UpdateSelectionRequest) => Promise<void>;
  deleteSelection: (selectionId: ID) => Promise<void>;
  /** 付箋を起点に Selection を作成し、昇格元付箋を promoted にする */
  promoteNote: (noteId: ID) => Promise<Selection | null>;
  discardNote: (noteId: ID) => Promise<void>;

  toast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '不明なエラーが発生しました';
}

// --- 音声設定の永続化(localStorage)。SSR / プライベートモードでも壊れないよう try/catch でガード ---
const LS_AUDIO_GAIN = 'veh.audioGain';
const LS_AUDIO_MUTED = 'veh.audioMuted';
const LS_AUDIO_SINK = 'veh.audioSinkId';

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, value);
  } catch {
    // 保存失敗は無視(プライベートモード等)
  }
}

function initialAudioGain(): number {
  const raw = lsGet(LS_AUDIO_GAIN);
  if (raw === null) return 1;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? clampGain(n) : 1;
}

function initialAudioMuted(): boolean {
  return lsGet(LS_AUDIO_MUTED) === '1';
}

function initialAudioSinkId(): string {
  return lsGet(LS_AUDIO_SINK) ?? '';
}

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  jobs: [],
  loadingProject: true,
  toasts: [],

  selectedDayId: null,
  selectedClipId: null,
  helpOpen: false,
  preferProxy: false,
  audioGain: initialAudioGain(),
  audioMuted: initialAudioMuted(),
  audioSinkId: initialAudioSinkId(),
  highlightSelectionId: null,

  _jobTimer: null,

  init: async () => {
    set({ loadingProject: true });
    try {
      const { project } = await api.getProject();
      set({ project, loadingProject: false });
    } catch (e) {
      // バックエンド未起動でも壊れない(画面遷移はルーター側で解決)
      set({ loadingProject: false });
      get().toast(errMessage(e));
    }
    // ジョブは常に一度取得し、必要ならポーリング開始
    await get().refreshJobs();
    get().startJobPolling();
  },

  refreshProject: async () => {
    try {
      const { project } = await api.getProject();
      set({ project });
    } catch (e) {
      get().toast(errMessage(e));
    }
  },

  refreshJobs: async () => {
    try {
      const { jobs } = await api.getJobs();
      const prev = get().jobs;
      set({ jobs });
      // 監視対象ジョブが完了した瞬間を検知してプロジェクト再取得
      // (scan: Day/Clip 構成が変わる, proxy: proxyAvailable が立つ など)
      const wasActive = (type: JobType) =>
        prev.some((j) => j.type === type && (j.status === 'running' || j.status === 'queued'));
      const nowActive = (type: JobType) =>
        jobs.some((j) => j.type === type && (j.status === 'running' || j.status === 'queued'));
      const settled = (type: JobType) => wasActive(type) && !nowActive(type);

      // scan / proxy が落ち着いたら clips を再取得(proxyAvailable 反映のため)
      if (settled('scan') || settled('proxy')) {
        await get().refreshProject();
      }
    } catch {
      // ジョブ取得失敗は静かに無視(次のポーリングで回復)
    }
  },

  startJobPolling: () => {
    if (get()._jobTimer) return;
    const tick = async () => {
      await get().refreshJobs();
      const active = get().jobs.some(
        (j) => j.status === 'running' || j.status === 'queued',
      );
      if (!active) {
        get().stopJobPolling();
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    set({ _jobTimer: timer });
  },

  stopJobPolling: () => {
    const t = get()._jobTimer;
    if (t) clearInterval(t);
    set({ _jobTimer: null });
  },

  setSelected: ({ dayId, clipId }) =>
    set((s) => ({
      selectedDayId: dayId === undefined ? s.selectedDayId : dayId,
      selectedClipId: clipId === undefined ? s.selectedClipId : clipId,
    })),

  setHighlightSelection: (selectionId) => set({ highlightSelectionId: selectionId }),

  toggleHelp: (open) =>
    set((s) => ({ helpOpen: open === undefined ? !s.helpOpen : open })),

  setPreferProxy: (on) => set({ preferProxy: on }),

  setAudioGain: (gain) => {
    const g = clampGain(gain);
    set({ audioGain: g });
    lsSet(LS_AUDIO_GAIN, String(g));
  },

  toggleMute: () =>
    set((s) => {
      const next = !s.audioMuted;
      lsSet(LS_AUDIO_MUTED, next ? '1' : '0');
      return { audioMuted: next };
    }),

  setAudioSinkId: (id) => {
    set({ audioSinkId: id });
    lsSet(LS_AUDIO_SINK, id);
  },

  saveSettings: async (settings) => {
    try {
      const { project } = await api.updateSettings({ settings });
      set({ project });
    } catch (e) {
      get().toast(errMessage(e));
      throw e;
    }
  },

  startScan: async (mediaRoots) => {
    try {
      await api.startScan(mediaRoots ? { mediaRoots } : {});
      get().toast('スキャンを開始しました', 'info');
      await get().refreshJobs();
      get().startJobPolling();
    } catch (e) {
      get().toast(errMessage(e));
    }
  },

  enqueue: async (type, clipIds) => {
    try {
      await api.enqueue({ type, clipIds });
      await get().refreshJobs();
      get().startJobPolling();
    } catch (e) {
      get().toast(errMessage(e));
    }
  },

  cycleReview: async (clipId) => {
    const clip = get().project?.clips[clipId];
    if (!clip) return;
    const idx = REVIEW_CYCLE.indexOf(clip.reviewStatus);
    const next = REVIEW_CYCLE[(idx + 1) % REVIEW_CYCLE.length]!;
    await get().setReview(clipId, next);
  },

  setReview: async (clipId, status) => {
    const project = get().project;
    const prev = project?.clips[clipId];
    if (!project || !prev) return;
    // 楽観的更新
    patchClip(set, clipId, { reviewStatus: status });
    try {
      const { clip } = await api.setReview(clipId, status);
      replaceClip(set, clip);
    } catch (e) {
      patchClip(set, clipId, { reviewStatus: prev.reviewStatus });
      get().toast(errMessage(e));
    }
  },

  pushWatched: async (clipId, ranges) => {
    if (ranges.length === 0) return;
    try {
      const { clip } = await api.addWatched(clipId, { ranges });
      replaceClip(set, clip);
    } catch (e) {
      // ローカルにはマージ済みなので致命的ではない。軽く通知
      get().toast(errMessage(e));
    }
  },

  mergeWatchedLocal: (clipId, ranges) => {
    const clip = get().project?.clips[clipId];
    if (!clip) return;
    let merged = clip.watchedRanges;
    for (const r of ranges) merged = addRange(merged, r);
    patchClip(set, clipId, { watchedRanges: merged });
  },

  addNote: async (clipId, timeSec, text, tags) => {
    try {
      const { note } = await api.createNote(clipId, { timeSec, text, tags });
      set((s) => {
        if (!s.project) return s;
        return {
          project: {
            ...s.project,
            notes: { ...s.project.notes, [note.id]: note },
          },
        };
      });
      return note;
    } catch (e) {
      get().toast(errMessage(e));
      return null;
    }
  },

  updateNote: async (noteId, patch) => {
    const project = get().project;
    const prev = project?.notes[noteId];
    if (!project || !prev) return;
    const optimistic: Note = { ...prev, ...patch, updatedAt: new Date().toISOString() };
    setNote(set, optimistic);
    try {
      const { note } = await api.updateNote(noteId, patch);
      setNote(set, note);
    } catch (e) {
      setNote(set, prev);
      get().toast(errMessage(e));
    }
  },

  deleteNote: async (noteId) => {
    const project = get().project;
    const prev = project?.notes[noteId];
    if (!project || !prev) return;
    // 楽観的に除去
    set((s) => {
      if (!s.project) return s;
      const next = { ...s.project.notes };
      delete next[noteId];
      return { project: { ...s.project, notes: next } };
    });
    try {
      await api.deleteNote(noteId);
    } catch (e) {
      setNote(set, prev);
      get().toast(errMessage(e));
    }
  },

  createSelection: async (clipId, req) => {
    try {
      const { selection } = await api.createSelection(clipId, req);
      setSelection(set, selection);
      // 昇格元付箋がある場合、サーバーが promoted に更新するため再取得して整合させる
      if (req.noteId) {
        await get().refreshProject();
        setSelection(set, selection); // 再取得で取り違えないよう作成分は確実に保持
      }
      return selection;
    } catch (e) {
      get().toast(errMessage(e));
      return null;
    }
  },

  updateSelection: async (selectionId, patch) => {
    const project = get().project;
    const prev = project?.selections[selectionId];
    if (!project || !prev) return;
    const optimistic: Selection = {
      ...prev,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    setSelection(set, optimistic);
    try {
      const { selection } = await api.updateSelection(selectionId, patch);
      setSelection(set, selection);
    } catch (e) {
      setSelection(set, prev);
      get().toast(errMessage(e));
    }
  },

  deleteSelection: async (selectionId) => {
    const project = get().project;
    const prev = project?.selections[selectionId];
    if (!project || !prev) return;
    // 楽観的に除去
    removeSelection(set, selectionId);
    try {
      await api.deleteSelection(selectionId);
      // サーバーが昇格元付箋を open に戻すので、付箋状態を反映するため再取得
      if (prev.noteId) await get().refreshProject();
    } catch (e) {
      setSelection(set, prev);
      get().toast(errMessage(e));
    }
  },

  promoteNote: async (noteId) => {
    const project = get().project;
    const note = project?.notes[noteId];
    if (!project || !note) return null;
    const clip = project.clips[note.clipId];
    if (!clip) return null;
    const win = promotionWindow(note.timeSec, clip.durationSec);
    return get().createSelection(note.clipId, {
      inSec: win.start,
      outSec: win.end,
      text: note.text,
      tags: note.tags,
      noteId,
    });
  },

  discardNote: async (noteId) => {
    await get().updateNote(noteId, { status: 'discarded' });
  },

  toast: (message, kind = 'error') => {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// --- ストア内部のミューテーションヘルパ ---

type SetFn = (
  partial: Partial<AppState> | ((s: AppState) => Partial<AppState>),
) => void;

function patchClip(set: SetFn, clipId: ID, patch: Partial<Clip>) {
  set((s) => {
    const clip = s.project?.clips[clipId];
    if (!s.project || !clip) return s;
    return {
      project: {
        ...s.project,
        clips: { ...s.project.clips, [clipId]: { ...clip, ...patch } },
      },
    };
  });
}

function replaceClip(set: SetFn, clip: Clip) {
  set((s) => {
    if (!s.project) return s;
    return {
      project: { ...s.project, clips: { ...s.project.clips, [clip.id]: clip } },
    };
  });
}

function setNote(set: SetFn, note: Note) {
  set((s) => {
    if (!s.project) return s;
    return {
      project: { ...s.project, notes: { ...s.project.notes, [note.id]: note } },
    };
  });
}

function setSelection(set: SetFn, selection: Selection) {
  set((s) => {
    if (!s.project) return s;
    return {
      project: {
        ...s.project,
        selections: { ...s.project.selections, [selection.id]: selection },
      },
    };
  });
}

function removeSelection(set: SetFn, selectionId: ID) {
  set((s) => {
    if (!s.project) return s;
    const next = { ...s.project.selections };
    delete next[selectionId];
    return { project: { ...s.project, selections: next } };
  });
}

// --- セレクタ(コンポーネントから使う派生データ) ---

export interface DaySummary {
  clipCount: number;
  totalDurationSec: number;
  noteCount: number;
  /** 未処理(open)の付箋数。トリアージ入口の残り件数に使う */
  openNoteCount: number;
  /** 0..1 */
  coverage: number;
  reviewedCount: number;
  /** Day 内の選定数 */
  selectionCount: number;
  /** Day 内の選定合計尺(秒) */
  selectionTotalSec: number;
}

const EMPTY_DAY_SUMMARY: DaySummary = {
  clipCount: 0,
  totalDurationSec: 0,
  noteCount: 0,
  openNoteCount: 0,
  coverage: 0,
  reviewedCount: 0,
  selectionCount: 0,
  selectionTotalSec: 0,
};

/** Day の集計(クリップ時間合算でカバレッジを出す) */
export function summarizeDay(project: ProjectState, dayId: ID): DaySummary {
  const day = project.days.find((d) => d.id === dayId);
  if (!day) return EMPTY_DAY_SUMMARY;

  let totalDur = 0;
  let watched = 0;
  let reviewed = 0;
  let noteCount = 0;
  let openNoteCount = 0;
  for (const clipId of day.clipIds) {
    const clip = project.clips[clipId];
    if (!clip) continue;
    totalDur += clip.durationSec;
    watched += rangesTotal(clip.watchedRanges);
    if (clip.reviewStatus === 'reviewed') reviewed++;
    for (const n of notesForClip(project, clipId)) {
      noteCount++;
      if (n.status === 'open') openNoteCount++;
    }
  }

  const clipSet = new Set(day.clipIds);
  let selectionCount = 0;
  let selectionTotalSec = 0;
  for (const s of Object.values(projectSelections(project))) {
    if (!clipSet.has(s.clipId)) continue;
    selectionCount++;
    if (s.outSec > s.inSec) selectionTotalSec += s.outSec - s.inSec;
  }

  return {
    clipCount: day.clipIds.length,
    totalDurationSec: totalDur,
    noteCount,
    openNoteCount,
    coverage: totalDur > 0 ? Math.min(1, watched / totalDur) : 0,
    reviewedCount: reviewed,
    selectionCount,
    selectionTotalSec,
  };
}

export function notesForClip(project: ProjectState, clipId: ID): Note[] {
  return Object.values(project.notes)
    .filter((n) => n.clipId === clipId)
    .sort((a, b) => a.timeSec - b.timeSec);
}

/** 旧データ互換: selections が無い場合に空オブジェクトを返す */
export function projectSelections(project: ProjectState): Record<ID, Selection> {
  return project.selections ?? {};
}

export function clipCoverage(clip: Clip): number {
  return coverage(clip.watchedRanges, clip.durationSec);
}
