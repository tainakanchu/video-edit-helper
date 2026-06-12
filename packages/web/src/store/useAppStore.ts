import {
  addRange,
  coverage,
  rangesTotal,
  type Clip,
  type ID,
  type JobInfo,
  type Note,
  type ProjectSettings,
  type ProjectState,
  type ReviewStatus,
  type TimeRange,
} from '@veh/shared';
import { create } from 'zustand';
import { api, ApiError } from '../api/client';

export type ViewName = 'setup' | 'day' | 'clip';

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

  // --- ナビゲーション / 選択状態 ---
  view: ViewName;
  selectedDayId: ID | null;
  selectedClipId: ID | null;
  helpOpen: boolean;

  // --- ポーリング(内部) ---
  _jobTimer: ReturnType<typeof setInterval> | null;

  // --- アクション ---
  init: () => Promise<void>;
  refreshProject: () => Promise<void>;
  refreshJobs: () => Promise<void>;
  startJobPolling: () => void;
  stopJobPolling: () => void;

  selectDay: (dayId: ID) => void;
  openClip: (clipId: ID) => void;
  backToDay: () => void;
  goSetup: () => void;
  toggleHelp: (open?: boolean) => void;

  saveSettings: (settings: Partial<ProjectSettings>) => Promise<void>;
  startScan: (mediaRoots?: string[]) => Promise<void>;

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

  toast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

function errMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '不明なエラーが発生しました';
}

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  jobs: [],
  loadingProject: true,
  toasts: [],

  view: 'day',
  selectedDayId: null,
  selectedClipId: null,
  helpOpen: false,

  _jobTimer: null,

  init: async () => {
    set({ loadingProject: true });
    try {
      const { project } = await api.getProject();
      const hasClips = Object.keys(project.clips).length > 0;
      const hasRoots = project.settings.mediaRoots.length > 0;
      const firstDay = project.days[0]?.id ?? null;
      set({
        project,
        loadingProject: false,
        view: !hasClips && !hasRoots ? 'setup' : 'day',
        selectedDayId: firstDay,
      });
    } catch (e) {
      // バックエンド未起動でも壊れない: 空の Setup へ
      set({ loadingProject: false, view: 'setup' });
      get().toast(errMessage(e));
    }
    // ジョブは常に一度取得し、必要ならポーリング開始
    await get().refreshJobs();
    get().startJobPolling();
  },

  refreshProject: async () => {
    try {
      const { project } = await api.getProject();
      set((s) => {
        // 選択中 Day が消えていたら先頭へ
        const dayStillExists = project.days.some((d) => d.id === s.selectedDayId);
        return {
          project,
          selectedDayId: dayStillExists ? s.selectedDayId : project.days[0]?.id ?? null,
        };
      });
    } catch (e) {
      get().toast(errMessage(e));
    }
  },

  refreshJobs: async () => {
    try {
      const { jobs } = await api.getJobs();
      const prev = get().jobs;
      set({ jobs });
      // scan が完了した瞬間を検知してプロジェクト再取得
      const wasScanActive = prev.some(
        (j) => j.type === 'scan' && (j.status === 'running' || j.status === 'queued'),
      );
      const scanNowDone =
        wasScanActive &&
        !jobs.some(
          (j) => j.type === 'scan' && (j.status === 'running' || j.status === 'queued'),
        );
      if (scanNowDone) {
        await get().refreshProject();
        // スキャン完了後は Day 表示へ
        if (get().view === 'setup' && (get().project?.days.length ?? 0) > 0) {
          set({ view: 'day' });
        }
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

  selectDay: (dayId) => set({ selectedDayId: dayId, view: 'day' }),

  openClip: (clipId) => {
    const clip = get().project?.clips[clipId];
    set({
      selectedClipId: clipId,
      selectedDayId: clip?.dayId ?? get().selectedDayId,
      view: 'clip',
    });
  },

  backToDay: () => set({ view: 'day', selectedClipId: null, helpOpen: false }),

  goSetup: () => set({ view: 'setup' }),

  toggleHelp: (open) =>
    set((s) => ({ helpOpen: open === undefined ? !s.helpOpen : open })),

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

// --- セレクタ(コンポーネントから使う派生データ) ---

export interface DaySummary {
  clipCount: number;
  totalDurationSec: number;
  noteCount: number;
  /** 0..1 */
  coverage: number;
  reviewedCount: number;
}

/** Day の集計(クリップ時間合算でカバレッジを出す) */
export function summarizeDay(project: ProjectState, dayId: ID): DaySummary {
  const day = project.days.find((d) => d.id === dayId);
  if (!day) {
    return { clipCount: 0, totalDurationSec: 0, noteCount: 0, coverage: 0, reviewedCount: 0 };
  }
  let totalDur = 0;
  let watched = 0;
  let reviewed = 0;
  for (const clipId of day.clipIds) {
    const clip = project.clips[clipId];
    if (!clip) continue;
    totalDur += clip.durationSec;
    watched += rangesTotal(clip.watchedRanges);
    if (clip.reviewStatus === 'reviewed') reviewed++;
  }
  const noteCount = day.clipIds.reduce(
    (n, clipId) => n + notesForClip(project, clipId).length,
    0,
  );
  return {
    clipCount: day.clipIds.length,
    totalDurationSec: totalDur,
    noteCount,
    coverage: totalDur > 0 ? Math.min(1, watched / totalDur) : 0,
    reviewedCount: reviewed,
  };
}

export function notesForClip(project: ProjectState, clipId: ID): Note[] {
  return Object.values(project.notes)
    .filter((n) => n.clipId === clipId)
    .sort((a, b) => a.timeSec - b.timeSec);
}

export function clipCoverage(clip: Clip): number {
  return coverage(clip.watchedRanges, clip.durationSec);
}
