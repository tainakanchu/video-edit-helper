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
import { applyIdRemap, computeIdRemap, migrateCacheDirsSync, type CacheDirs } from './migrateIds.js';

// OneDrive 等の同期フォルダに置かれても壊れにくいよう、書き込みは控えめにする。
// (頻繁な書き込み=タイムスタンプ更新は同期先で偽の競合やチャーンの原因になる)
const SAVE_DEBOUNCE_MS = 1500;
// 連続編集でも最初の変更からこの時間で必ず書き出す(クラッシュ時のデータ損失の上限)
const MAX_COALESCE_MS = 15 * 1000;
const BACKUP_MIN_INTERVAL_MS = 5 * 60 * 1000;
const BACKUP_KEEP = 50;

export interface ProjectStoreOptions {
  projectFile: string;
  backupsDir: string;
  /** デバウンス無効化(テスト用) */
  saveDebounceMs?: number;
  /**
   * キャッシュディレクトリ群。指定時のみ v1→v2 移行でキャッシュも rename する。
   * 未指定(テスト等)ではキャッシュ rename をスキップする。
   */
  cacheDirs?: CacheDirs;
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
  /** 保留中の最初の変更時刻(coalesce の上限計算用。0 なら保留なし) */
  private pendingSince = 0;

  private constructor(state: ProjectState, opts: ProjectStoreOptions) {
    this.state = state;
    this.projectFile = opts.projectFile;
    this.backupsDir = opts.backupsDir;
    this.debounceMs = opts.saveDebounceMs ?? SAVE_DEBOUNCE_MS;
  }

  /**
   * project.json をロード。無ければ defaultSettings で新規作成。
   * 保存ファイルが存在するのに読めない(OneDrive 等でローカル未取得=データレス、
   * または破損)場合は {@link ProjectUnreadableError} を投げる。
   * 空データで上書きしてクラウドの本物を壊さないよう、呼び出し側は起動を止めず
   * 「保存先を直す」導線に倒すこと。
   */
  static load(opts: ProjectStoreOptions): ProjectStore {
    let state: ProjectState;
    if (fs.existsSync(opts.projectFile)) {
      // クラウド同期フォルダ(OneDrive/iCloud 等)では、ファイルがメタデータだけ存在し
      // 実体がローカルに無い「オンラインのみ」状態になり得る。その状態で読むと
      // ハング/タイムアウトするので、読む前に検知して明示的なエラーにする。
      if (isDatalessPlaceholder(opts.projectFile)) {
        throw new ProjectUnreadableError(opts.projectFile);
      }
      let raw: string;
      try {
        raw = fs.readFileSync(opts.projectFile, 'utf8');
        state = JSON.parse(raw) as ProjectState;
      } catch (e) {
        throw new ProjectUnreadableError(opts.projectFile, e);
      }
      // Phase 2 マイグレーション: 旧データに selections が無ければ {} で初期化
      if (!state.selections) state.selections = {};
      // Phase 4 マイグレーション: 旧データに無い設定キー(proxyAllFiles 等)を
      // defaultSettings で補完する
      state.settings = { ...defaultSettings, ...state.settings };

      // v1 → v2 マイグレーション: ID をパス由来から内容指紋由来へ移行する。
      // 素材を別ドライブへ移動してもメモ・選定・レビュー・キャッシュが
      // デタッチされないようにする(起動時に一度だけ実行)。
      const currentVersion = state.version ?? 1;
      if (currentVersion < 2) {
        // 移行前の原本を退避(冪等ではないので初回のみ意味を持つ)
        if (fs.existsSync(opts.projectFile) && fs.existsSync(opts.backupsDir)) {
          try {
            const stamp = timestampName(new Date());
            const dest = path.join(opts.backupsDir, `premigrate-v1-${stamp}.json`);
            fs.copyFileSync(opts.projectFile, dest);
          } catch (err) {
            console.warn(`[migrate] 事前バックアップに失敗(継続): ${String(err)}`);
          }
        }
        const maps = computeIdRemap(state);
        if (maps.changed) {
          state = applyIdRemap(state, maps);
          if (opts.cacheDirs) migrateCacheDirsSync(opts.cacheDirs, maps);
        } else {
          state.version = 2;
        }
        // 移行済み state を同期書き込み(次回起動で再実行されないよう durable に)
        fs.writeFileSync(opts.projectFile, JSON.stringify(state, null, 2), 'utf8');
        console.log(
          `[migrate] project.json を v2(fingerprint ID)へ移行しました (clips remapped: ${maps.changed})`,
        );
      }
    } else {
      state = {
        // 新規作成は最初から v2(指紋由来 ID)
        version: 2,
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

  /** デバウンス保存をスケジュール(連続編集は MAX_COALESCE_MS で必ず書き出す) */
  private scheduleSave(): void {
    const now = Date.now();
    if (this.pendingSince === 0) this.pendingSince = now;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // 連続編集で書き込みを間引きつつ、溜め込みすぎない上限を設ける
    const maxWaitLeft = Math.max(0, this.pendingSince + MAX_COALESCE_MS - now);
    const wait = Math.min(this.debounceMs, maxWaitLeft);
    this.saveTimer = setTimeout(() => {
      void this.flush();
    }, wait);
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

    // 変更が無ければ書き込まない。同期先(OneDrive 等)で無駄なファイル更新
    // (=タイムスタンプ更新→偽の競合や同期チャーン)を避けるベストプラクティス。
    if (!changed) {
      this.pendingSince = 0;
      return;
    }

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
    this.pendingSince = 0;
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

/**
 * OneDrive/iCloud 等の「オンラインのみ(未ダウンロード)」プレースホルダかどうか。
 * 論理サイズ>0 なのに割り当てブロック=0 のとき、実体がローカルに無い(=読むと失敗する)。
 */
export function isDatalessPlaceholder(file: string): boolean {
  try {
    const st = fs.statSync(file);
    return st.size > 0 && st.blocks === 0;
  } catch {
    return false;
  }
}

/**
 * project.json が存在するのに読めない状態(クラウド未取得のデータレス、または破損)。
 * これを起動時に握りつぶして空データで保存すると本物を壊すため、専用の型で区別する。
 */
export class ProjectUnreadableError extends Error {
  readonly path: string;
  constructor(path: string, cause?: unknown) {
    super(
      `プロジェクトの保存ファイルを読み込めませんでした: ${path} ` +
        `(OneDrive 等のクラウド上のみでローカルに未取得か、ファイル破損の可能性)`,
    );
    this.name = 'ProjectUnreadableError';
    this.path = path;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
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
