import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import {
  addRange,
  defaultSettings,
  normalizeRanges,
  type Clip,
  type Day,
  type ID,
  type Note,
  type NoteStatus,
  type ProjectSettings,
  type ProjectState,
  type ReviewStatus,
  type Selection,
  type TimeRange,
} from '@veh/shared';

const SAVE_DEBOUNCE_MS = 500;
const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_KEEP = 50;

export interface ProjectStoreOptions {
  projectFile: string;
  backupsDir: string;
  /** デバウンス無効化(テスト用) */
  saveDebounceMs?: number;
}

/** project.json の永続化とドメイン状態の保持を担う */
export class ProjectStore {
  private state: ProjectState;
  private readonly projectFile: string;
  private readonly backupsDir: string;
  private readonly debounceMs: number;
  private saveTimer: NodeJS.Timeout | null = null;
  private lastBackupAt = 0;
  private lastSavedJson = '';

  private constructor(state: ProjectState, opts: ProjectStoreOptions) {
    this.state = state;
    this.projectFile = opts.projectFile;
    this.backupsDir = opts.backupsDir;
    this.debounceMs = opts.saveDebounceMs ?? SAVE_DEBOUNCE_MS;
  }

  /** project.json をロード。無ければ defaultSettings で新規作成 */
  static load(opts: ProjectStoreOptions): ProjectStore {
    let state: ProjectState;
    if (fs.existsSync(opts.projectFile)) {
      const raw = fs.readFileSync(opts.projectFile, 'utf8');
      state = JSON.parse(raw) as ProjectState;
      // Phase 2 マイグレーション: 旧データに selections が無ければ {} で初期化
      if (!state.selections) state.selections = {};
      // Phase 4 マイグレーション: 旧データに無い設定キー(proxyAllFiles 等)を
      // defaultSettings で補完する
      state.settings = { ...defaultSettings, ...state.settings };
    } else {
      state = {
        version: 1,
        settings: { ...defaultSettings },
        days: [],
        clips: {},
        notes: {},
        selections: {},
      };
    }
    const store = new ProjectStore(state, opts);
    store.lastSavedJson = JSON.stringify(store.state);
    return store;
  }

  getState(): ProjectState {
    return this.state;
  }

  getSettings(): ProjectSettings {
    return this.state.settings;
  }

  getClip(clipId: ID): Clip | undefined {
    return this.state.clips[clipId];
  }

  getAllClips(): Clip[] {
    return Object.values(this.state.clips);
  }

  /** fileId から (clip, ファイルパス) を解決 */
  resolveFile(fileId: ID): { clip: Clip; path: string } | undefined {
    for (const clip of Object.values(this.state.clips)) {
      const f = clip.files.find((sf) => sf.id === fileId);
      if (f) return { clip, path: f.path };
    }
    return undefined;
  }

  updateSettings(partial: Partial<ProjectSettings>): ProjectSettings {
    this.state.settings = { ...this.state.settings, ...partial };
    this.scheduleSave();
    return this.state.settings;
  }

  /**
   * 再スキャン結果でマージ。
   * 同一 clipId の既存クリップの reviewStatus / watchedRanges は必ず保持。
   * 同一 fileId の proxyAvailable フラグも引き継ぐ。
   * notes / selections は孤児も含め一切削除しない。
   */
  replaceScanResult(days: Day[], clips: Clip[]): void {
    // 既存ファイルの proxyAvailable を fileId で引き継ぐためのインデックス
    const prevProxy = new Map<ID, boolean>();
    for (const c of Object.values(this.state.clips)) {
      for (const f of c.files) {
        if (f.proxyAvailable) prevProxy.set(f.id, true);
      }
    }

    const newClips: Record<ID, Clip> = {};
    for (const c of clips) {
      // 再スキャンで作り直された SourceFile に proxyAvailable を復元
      const files = c.files.map((f) =>
        prevProxy.get(f.id) ? { ...f, proxyAvailable: true } : f,
      );
      const prev = this.state.clips[c.id];
      if (prev) {
        newClips[c.id] = {
          ...c,
          files,
          reviewStatus: prev.reviewStatus,
          watchedRanges: prev.watchedRanges,
        };
      } else {
        newClips[c.id] = { ...c, files };
      }
    }
    this.state.days = days;
    this.state.clips = newClips;
    // notes / selections はそのまま保持(孤児も削除しない)
    this.scheduleSave();
  }

  createNote(clipId: ID, timeSec: number, text: string, tags: string[]): Note {
    const now = new Date().toISOString();
    const note: Note = {
      id: nanoid(12),
      clipId,
      timeSec,
      text,
      tags,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    this.state.notes[note.id] = note;
    this.scheduleSave();
    return note;
  }

  updateNote(
    noteId: ID,
    patch: { text?: string; tags?: string[]; status?: NoteStatus; timeSec?: number },
  ): Note | undefined {
    const note = this.state.notes[noteId];
    if (!note) return undefined;
    if (patch.text !== undefined) note.text = patch.text;
    if (patch.tags !== undefined) note.tags = patch.tags;
    if (patch.status !== undefined) note.status = patch.status;
    if (patch.timeSec !== undefined) note.timeSec = patch.timeSec;
    note.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return note;
  }

  deleteNote(noteId: ID): boolean {
    if (!this.state.notes[noteId]) return false;
    delete this.state.notes[noteId];
    this.scheduleSave();
    return true;
  }

  getSelection(selectionId: ID): Selection | undefined {
    return this.state.selections[selectionId];
  }

  getAllSelections(): Selection[] {
    return Object.values(this.state.selections);
  }

  /** 指定クリップに属する Selection 群 */
  getSelectionsForClip(clipId: ID): Selection[] {
    return Object.values(this.state.selections).filter((s) => s.clipId === clipId);
  }

  /**
   * Selection を新規作成。
   * noteId 指定があれば該当 Note を promoted に更新する(昇格フロー)。
   */
  createSelection(
    clipId: ID,
    input: {
      inSec: number;
      outSec: number;
      text?: string;
      tags?: string[];
      rating?: 0 | 1 | 2 | 3;
      noteId?: ID;
    },
  ): Selection {
    const now = new Date().toISOString();
    const selection: Selection = {
      id: nanoid(12),
      clipId,
      inSec: input.inSec,
      outSec: input.outSec,
      text: input.text ?? '',
      tags: input.tags ?? [],
      rating: input.rating ?? 0,
      noteId: input.noteId ?? null,
      orderKey: null,
      createdAt: now,
      updatedAt: now,
    };
    this.state.selections[selection.id] = selection;
    // 昇格元の付箋があれば promoted に更新
    if (input.noteId) {
      const note = this.state.notes[input.noteId];
      if (note) {
        note.status = 'promoted';
        note.updatedAt = now;
      }
    }
    this.scheduleSave();
    return selection;
  }

  updateSelection(
    selectionId: ID,
    patch: {
      inSec?: number;
      outSec?: number;
      text?: string;
      tags?: string[];
      rating?: 0 | 1 | 2 | 3;
      orderKey?: number | null;
    },
  ): Selection | undefined {
    const sel = this.state.selections[selectionId];
    if (!sel) return undefined;
    if (patch.inSec !== undefined) sel.inSec = patch.inSec;
    if (patch.outSec !== undefined) sel.outSec = patch.outSec;
    if (patch.text !== undefined) sel.text = patch.text;
    if (patch.tags !== undefined) sel.tags = patch.tags;
    if (patch.rating !== undefined) sel.rating = patch.rating;
    if (patch.orderKey !== undefined) sel.orderKey = patch.orderKey;
    sel.updatedAt = new Date().toISOString();
    this.scheduleSave();
    return sel;
  }

  /**
   * Selection を削除。
   * 紐づく Note(noteId)が存在し promoted なら open へ戻す。
   */
  deleteSelection(selectionId: ID): boolean {
    const sel = this.state.selections[selectionId];
    if (!sel) return false;
    if (sel.noteId) {
      const note = this.state.notes[sel.noteId];
      if (note && note.status === 'promoted') {
        note.status = 'open';
        note.updatedAt = new Date().toISOString();
      }
    }
    delete this.state.selections[selectionId];
    this.scheduleSave();
    return true;
  }

  /** プロキシ生成済みフラグを設定(永続化)。対象ファイルが無ければ false */
  setProxyAvailable(fileId: ID, available: boolean): boolean {
    for (const clip of Object.values(this.state.clips)) {
      const f = clip.files.find((sf) => sf.id === fileId);
      if (f) {
        f.proxyAvailable = available;
        this.scheduleSave();
        return true;
      }
    }
    return false;
  }

  setReviewStatus(clipId: ID, status: ReviewStatus): Clip | undefined {
    const clip = this.state.clips[clipId];
    if (!clip) return undefined;
    clip.reviewStatus = status;
    this.scheduleSave();
    return clip;
  }

  /**
   * 視聴済み区間を追加マージ。
   * unreviewed のクリップは自動で in_progress に昇格(reviewed は変えない)。
   */
  addWatchedRanges(clipId: ID, ranges: TimeRange[]): Clip | undefined {
    const clip = this.state.clips[clipId];
    if (!clip) return undefined;
    let merged = clip.watchedRanges;
    for (const r of ranges) {
      merged = addRange(merged, r);
    }
    clip.watchedRanges = normalizeRanges(merged);
    if (clip.reviewStatus === 'unreviewed') {
      clip.reviewStatus = 'in_progress';
    }
    this.scheduleSave();
    return clip;
  }

  /** デバウンス保存をスケジュール */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
    // テストやプロセス終了をブロックしない
    this.saveTimer.unref?.();
  }

  /** 保留中の保存を即座に実行(終了時用) */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist();
  }

  /** 保留中のタイマーを破棄(保存はしない・テスト/終了時用) */
  dispose(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  /** atomic write + 世代バックアップ */
  private async persist(): Promise<void> {
    const json = JSON.stringify(this.state, null, 2);
    const changed = json !== this.lastSavedJson;

    // 内容変化時のバックアップ判定(本体書き込み前の現行ファイルを退避)
    if (changed && fs.existsSync(this.projectFile)) {
      const now = Date.now();
      if (now - this.lastBackupAt >= BACKUP_MIN_INTERVAL_MS) {
        await this.makeBackup();
        this.lastBackupAt = now;
      }
    }

    // atomic write: tmp → rename
    const tmp = `${this.projectFile}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, json, 'utf8');
    await fsp.rename(tmp, this.projectFile);
    this.lastSavedJson = json;
  }

  /** 現行 project.json を backups/ に世代退避し、新しい順 50 件に整理 */
  private async makeBackup(): Promise<void> {
    const stamp = timestampName(new Date());
    const dest = path.join(this.backupsDir, `project-${stamp}.json`);
    await fsp.copyFile(this.projectFile, dest);
    await this.rotateBackups();
  }

  /** バックアップを新しい順 BACKUP_KEEP 件に整理 */
  private async rotateBackups(): Promise<void> {
    const entries = (await fsp.readdir(this.backupsDir))
      .filter((n) => /^project-\d{14}\.json$/.test(n))
      .sort()
      .reverse();
    for (const old of entries.slice(BACKUP_KEEP)) {
      await fsp.rm(path.join(this.backupsDir, old), { force: true });
    }
  }
}

/** YYYYMMDDHHmmss(ローカル時刻) */
function timestampName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}
