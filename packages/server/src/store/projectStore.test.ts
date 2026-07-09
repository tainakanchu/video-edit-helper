import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clip } from '@veh/shared';
import { ProjectStore, ProjectUnreadableError, isDatalessPlaceholder } from './projectStore.js';

let dir: string;
let projectFile: string;
let backupsDir: string;
let stores: ProjectStore[];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-store-'));
  projectFile = path.join(dir, 'project.json');
  backupsDir = path.join(dir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  stores = [];
});

afterEach(() => {
  // 保留中のデバウンス保存タイマーを破棄してから tmp を消す
  for (const s of stores) s.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

function newStore(): ProjectStore {
  const store = ProjectStore.load({ projectFile, backupsDir, saveDebounceMs: 0 });
  stores.push(store);
  return store;
}

describe('同期先(OneDrive 等)向け: 無駄な書き込みの抑制', () => {
  it('内容が変わらなければ project.json を再書き込みしない', async () => {
    const store = newStore();
    store.updateSettings({ dayStartHour: 5 });
    await store.flush();
    expect(fs.existsSync(projectFile)).toBe(true);
    // 保存済みファイルを消し、変更なしで再 flush → 書き戻さない(=書き込みが起きていない証跡)
    fs.rmSync(projectFile);
    await store.flush();
    expect(fs.existsSync(projectFile)).toBe(false);
  });
});

function mkClip(id: string, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    dayId: '2025-01-01',
    name: `${id}.MP4`,
    cameraLabel: 'cam',
    files: [
      {
        id: `f-${id}`,
        path: `/media/${id}.MP4`,
        fileName: `${id}.MP4`,
        sizeBytes: 100,
        durationSec: 60,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        createdAt: null,
        mtime: '2025-01-01T00:00:00.000Z',
        startOffsetSec: 0,
        playableInBrowser: true,
      },
    ],
    durationSec: 60,
    recordedAt: '2025-01-01T10:00:00.000Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
    ...overrides,
  };
}

/** 指定パス・上書きでクリップを作る(cross-OS マウント対応表のテスト用) */
function mkClipAt(id: string, filePath: string, overrides: Partial<Clip> = {}): Clip {
  return mkClip(id, {
    files: [
      {
        id: `f-${id}`,
        path: filePath,
        fileName: `${id}.MP4`,
        sizeBytes: 100,
        durationSec: 60,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        createdAt: null,
        mtime: '2025-01-01T00:00:00.000Z',
        startOffsetSec: 0,
        playableInBrowser: true,
      },
    ],
    ...overrides,
  });
}

/** reapplyTimeSettings テスト用: createdAt 付きファイル 1 本のクリップを作る */
function mkTimeClip(
  id: string,
  opts: { cameraLabel: string; path: string; createdAt: string; recordedAt: string; dayId: string },
): Clip {
  return mkClip(id, {
    dayId: opts.dayId,
    cameraLabel: opts.cameraLabel,
    recordedAt: opts.recordedAt,
    files: [
      {
        id: `f-${id}`,
        path: opts.path,
        fileName: `${id}.MP4`,
        sizeBytes: 100,
        durationSec: 60,
        width: 1920,
        height: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        fps: 30,
        createdAt: opts.createdAt,
        mtime: '2025-01-01T00:00:00.000Z',
        startOffsetSec: 0,
        playableInBrowser: true,
      },
    ],
  });
}

describe('ProjectStore 永続化', () => {
  it('新規ロード時はデフォルト設定', () => {
    const store = newStore();
    expect(store.getSettings().dayStartHour).toBe(4);
    expect(store.getAllClips()).toHaveLength(0);
  });

  it('flush で atomic write される', async () => {
    const store = newStore();
    store.updateSettings({ dayStartHour: 6 });
    await store.flush();
    const saved = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    expect(saved.settings.dayStartHour).toBe(6);
  });

  it('保存後に再ロードして状態が復元される', async () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    store.createNote('c1', 5, 'メモ', ['tag']);
    await store.flush();

    const reloaded = newStore();
    expect(reloaded.getClip('c1')).toBeDefined();
    expect(Object.keys(reloaded.getState().notes)).toHaveLength(1);
  });
});

describe('世代バックアップ', () => {
  it('内容変化時にバックアップを作る', async () => {
    const store = newStore();
    store.updateSettings({ dayStartHour: 5 });
    await store.flush(); // 1 回目: project.json 作成(既存ファイル無いのでバックアップ無し)

    store.updateSettings({ dayStartHour: 6 });
    await store.flush(); // 2 回目: 既存ファイルありかつ 5 分経過扱い(lastBackupAt=0)→バックアップ

    const backups = fs.readdirSync(backupsDir).filter((n) => n.startsWith('project-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('バックアップは新しい順 50 件に整理される', async () => {
    const store = newStore();
    // 51 個の古いバックアップを直接配置
    for (let i = 0; i < 51; i++) {
      const stamp = `2025010100${String(i).padStart(2, '0')}00`.slice(0, 14);
      fs.writeFileSync(path.join(backupsDir, `project-${stamp}.json`), '{}');
    }
    // 本体保存を 2 回(2 回目でバックアップ→rotate）
    store.updateSettings({ dayStartHour: 5 });
    await store.flush();
    store.updateSettings({ dayStartHour: 7 });
    await store.flush();

    const backups = fs.readdirSync(backupsDir).filter((n) => /^project-\d{14}\.json$/.test(n));
    expect(backups.length).toBeLessThanOrEqual(50);
  });
});

describe('再スキャンマージ', () => {
  it('同一 clipId の reviewStatus / watchedRanges を保持する', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    store.setReviewStatus('c1', 'reviewed');
    store.addWatchedRanges('c1', [{ start: 0, end: 30 }]);

    // 再スキャン: 同じ clipId だが reviewStatus は unreviewed の新規 Clip
    store.replaceScanResult([mkClip('c1', { reviewStatus: 'unreviewed', watchedRanges: [] })]);

    const c = store.getClip('c1')!;
    expect(c.reviewStatus).toBe('reviewed');
    expect(c.watchedRanges).toEqual([{ start: 0, end: 30 }]);
  });

  it('消えたクリップの notes は孤児として保持される', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    store.createNote('c1', 5, 'メモ', []);

    // 再スキャンで c1 が消える(c2 のみ)
    store.replaceScanResult([mkClip('c2')]);
    expect(store.getClip('c1')).toBeUndefined();
    expect(Object.keys(store.getState().notes)).toHaveLength(1);
  });

  it('scannedRoots に含まれないルート配下の既存クリップは保持され、reviewStatus と days も維持される', () => {
    const store = newStore();
    // 初回スキャン: rootA(接続ドライブ) / rootB(未接続になる予定の HDD)の 2 クリップ
    store.replaceScanResult([
      mkClipAt('c1', '/media/rootA/c1.MP4', { dayId: '2025-01-01', recordedAt: '2025-01-01T10:00:00.000Z' }),
      mkClipAt('c2', '/media/rootB/c2.MP4', { dayId: '2025-01-02', recordedAt: '2025-01-02T10:00:00.000Z' }),
    ]);
    store.setReviewStatus('c2', 'reviewed');
    store.addWatchedRanges('c2', [{ start: 0, end: 20 }]);

    // 再スキャン: rootA のみ接続 → 見つかるのは c1 のみ。scannedRoots で rootB が未接続と伝える
    const { preservedCount } = store.replaceScanResult(
      [mkClipAt('c1', '/media/rootA/c1.MP4', { dayId: '2025-01-01', reviewStatus: 'unreviewed', watchedRanges: [] })],
      { scannedRoots: ['/media/rootA'] },
    );

    expect(preservedCount).toBe(1);
    // rootB 配下の c2 は消えず、reviewStatus / watchedRanges もそのまま
    const c2 = store.getClip('c2');
    expect(c2).toBeDefined();
    expect(c2!.reviewStatus).toBe('reviewed');
    expect(c2!.watchedRanges).toEqual([{ start: 0, end: 20 }]);
    // days が保持後の全クリップから再構築され、c2 の日も残っている
    const days = store.getState().days;
    expect(days.map((d) => d.date)).toEqual(['2025-01-01', '2025-01-02']);
    expect(days.find((d) => d.date === '2025-01-02')!.clipIds).toEqual(['c2']);
  });

  it('scannedRoots 未指定なら従来通り全置換(保持しない)', () => {
    const store = newStore();
    store.replaceScanResult([mkClipAt('c1', '/media/rootA/c1.MP4')]);
    const { preservedCount } = store.replaceScanResult([mkClipAt('c2', '/media/rootB/c2.MP4')]);
    expect(preservedCount).toBe(0);
    expect(store.getClip('c1')).toBeUndefined();
    expect(store.getClip('c2')).toBeDefined();
  });
});

describe('addWatchedRanges 昇格', () => {
  it('unreviewed は in_progress に昇格', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    store.addWatchedRanges('c1', [{ start: 0, end: 10 }]);
    expect(store.getClip('c1')!.reviewStatus).toBe('in_progress');
  });

  it('reviewed は昇格させない', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    store.setReviewStatus('c1', 'reviewed');
    store.addWatchedRanges('c1', [{ start: 0, end: 10 }]);
    expect(store.getClip('c1')!.reviewStatus).toBe('reviewed');
  });
});

describe('selections マイグレーション', () => {
  it('selections が無い旧 project.json をロードすると {} で初期化される', () => {
    // selections フィールドを持たない旧形式を直接書き込む
    const legacy = {
      version: 1,
      settings: { mediaRoots: [], dayStartHour: 4, thumbCoarseIntervalSec: 60, thumbFineIntervalSec: 10 },
      days: [],
      clips: {},
      notes: {},
    };
    fs.writeFileSync(projectFile, JSON.stringify(legacy));
    const store = newStore();
    expect(store.getState().selections).toEqual({});
    expect(store.getAllSelections()).toHaveLength(0);
  });

  it('新規ロード時も selections は {} で存在する', () => {
    const store = newStore();
    expect(store.getState().selections).toEqual({});
  });
});

describe('Selection CRUD', () => {
  it('createSelection はデフォルト rating 0 / orderKey null', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const sel = store.createSelection('c1', { inSec: 5, outSec: 10 });
    expect(sel.rating).toBe(0);
    expect(sel.orderKey).toBeNull();
    expect(sel.noteId).toBeNull();
    expect(sel.text).toBe('');
    expect(store.getSelection(sel.id)).toBeDefined();
    expect(store.getSelectionsForClip('c1')).toHaveLength(1);
  });

  it('noteId 付き createSelection は付箋を promoted に更新', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const note = store.createNote('c1', 5, 'メモ', []);
    const sel = store.createSelection('c1', { inSec: 5, outSec: 10, noteId: note.id });
    expect(sel.noteId).toBe(note.id);
    expect(store.getState().notes[note.id]!.status).toBe('promoted');
  });

  it('updateSelection は指定フィールドのみ更新', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const sel = store.createSelection('c1', { inSec: 5, outSec: 10, rating: 1 });
    const updated = store.updateSelection(sel.id, { rating: 3, orderKey: 2.5 });
    expect(updated!.rating).toBe(3);
    expect(updated!.orderKey).toBe(2.5);
    expect(updated!.inSec).toBe(5);
  });

  it('deleteSelection は promoted な付箋を open に戻す', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const note = store.createNote('c1', 5, 'メモ', []);
    const sel = store.createSelection('c1', { inSec: 5, outSec: 10, noteId: note.id });
    expect(store.getState().notes[note.id]!.status).toBe('promoted');
    expect(store.deleteSelection(sel.id)).toBe(true);
    expect(store.getState().notes[note.id]!.status).toBe('open');
    expect(store.getSelection(sel.id)).toBeUndefined();
  });

  it('deleteSelection: discarded な付箋は戻さない(promoted のみ open へ)', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const note = store.createNote('c1', 5, 'メモ', []);
    const sel = store.createSelection('c1', { inSec: 5, outSec: 10, noteId: note.id });
    // 付箋を手動で discarded にしておく
    store.updateNote(note.id, { status: 'discarded' });
    store.deleteSelection(sel.id);
    expect(store.getState().notes[note.id]!.status).toBe('discarded');
  });

  it('再スキャンしても selections は保持される', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const sel = store.createSelection('c1', { inSec: 5, outSec: 10 });
    store.replaceScanResult([mkClip('c1', { reviewStatus: 'unreviewed', watchedRanges: [] })]);
    expect(store.getSelection(sel.id)).toBeDefined();
  });
});

describe('proxyAvailable 永続化', () => {
  it('setProxyAvailable がファイルのフラグを立てる', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const fileId = store.getClip('c1')!.files[0]!.id;
    expect(store.setProxyAvailable(fileId, true)).toBe(true);
    expect(store.getClip('c1')!.files[0]!.proxyAvailable).toBe(true);
  });

  it('未知 fileId は false', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    expect(store.setProxyAvailable('nope', true)).toBe(false);
  });

  it('再スキャンで同一 fileId の proxyAvailable は引き継がれる', () => {
    const store = newStore();
    store.replaceScanResult([mkClip('c1')]);
    const fileId = store.getClip('c1')!.files[0]!.id;
    store.setProxyAvailable(fileId, true);
    // 再スキャン: 同じ fileId だが proxyAvailable 未設定の新規 Clip
    store.replaceScanResult([mkClip('c1', { reviewStatus: 'unreviewed', watchedRanges: [] })]);
    expect(store.getClip('c1')!.files[0]!.proxyAvailable).toBe(true);
  });
});

describe('reapplyTimeSettings(時刻補正の再スキャン不要な即時反映)', () => {
  it('cameraTimeOffsets 設定 → recordedAt が補正分ずれ、dayId・days も更新される', () => {
    const store = newStore();
    store.replaceScanResult([
      mkTimeClip('c1', {
        cameraLabel: 'cam1',
        path: '/media/root1/cam1/A.MP4',
        createdAt: '2025-01-01T10:00:00.000Z',
        recordedAt: '2025-01-01T10:00:00.000Z',
        dayId: '2025-01-01',
      }),
    ]);
    store.updateSettings({ mediaRoots: ['/media/root1'], cameraTimeOffsets: { cam1: 60 } });
    const { changed } = store.reapplyTimeSettings();
    expect(changed).toBe(1);
    const c1 = store.getClip('c1')!;
    expect(c1.recordedAt).toBe('2025-01-01T11:00:00.000Z');
    expect(c1.dayId).toBe('2025-01-01');
    const day = store.getState().days.find((d) => d.id === '2025-01-01');
    expect(day?.clipIds).toContain('c1');
  });

  it('rootTimeOffsets が files[0].path とルートの照合で効く(Windows 形式 root でも)', () => {
    const store = newStore();
    store.replaceScanResult([
      mkTimeClip('c2', {
        cameraLabel: 'cam2',
        path: 'D:\\Media\\cam2\\B.MP4',
        createdAt: '2025-01-01T10:00:00.000Z',
        recordedAt: '2025-01-01T10:00:00.000Z',
        dayId: '2025-01-01',
      }),
    ]);
    store.updateSettings({ mediaRoots: ['D:\\Media'], rootTimeOffsets: { 'D:\\Media': 30 } });
    const { changed } = store.reapplyTimeSettings();
    expect(changed).toBe(1);
    expect(store.getClip('c2')!.recordedAt).toBe('2025-01-01T10:30:00.000Z');
  });

  it('cameraTimeOffsets が rootTimeOffsets に優先する(加算されない)', () => {
    const store = newStore();
    store.replaceScanResult([
      mkTimeClip('c3', {
        cameraLabel: 'cam3',
        path: '/media/root1/cam3/C.MP4',
        createdAt: '2025-01-01T10:00:00.000Z',
        recordedAt: '2025-01-01T10:00:00.000Z',
        dayId: '2025-01-01',
      }),
    ]);
    store.updateSettings({
      mediaRoots: ['/media/root1'],
      cameraTimeOffsets: { cam3: 15 },
      rootTimeOffsets: { '/media/root1': 60 },
    });
    store.reapplyTimeSettings();
    expect(store.getClip('c3')!.recordedAt).toBe('2025-01-01T10:15:00.000Z');
  });

  it('2 回連続で呼んでも結果が変わらない(冪等)', () => {
    const store = newStore();
    store.replaceScanResult([
      mkTimeClip('c4', {
        cameraLabel: 'cam4',
        path: '/media/root1/cam4/D.MP4',
        createdAt: '2025-01-01T10:00:00.000Z',
        recordedAt: '2025-01-01T10:00:00.000Z',
        dayId: '2025-01-01',
      }),
    ]);
    store.updateSettings({ mediaRoots: ['/media/root1'], cameraTimeOffsets: { cam4: 90 } });
    const first = store.reapplyTimeSettings();
    const recordedAtAfterFirst = store.getClip('c4')!.recordedAt;
    const second = store.reapplyTimeSettings();
    expect(first.changed).toBe(1);
    expect(second.changed).toBe(0);
    expect(store.getClip('c4')!.recordedAt).toBe(recordedAtAfterFirst);
  });

  it('補正を 0 に戻すと元の recordedAt に戻る', () => {
    const store = newStore();
    store.replaceScanResult([
      mkTimeClip('c5', {
        cameraLabel: 'cam5',
        path: '/media/root1/cam5/E.MP4',
        createdAt: '2025-01-01T10:00:00.000Z',
        recordedAt: '2025-01-01T10:00:00.000Z',
        dayId: '2025-01-01',
      }),
    ]);
    store.updateSettings({ mediaRoots: ['/media/root1'], cameraTimeOffsets: { cam5: 45 } });
    store.reapplyTimeSettings();
    expect(store.getClip('c5')!.recordedAt).toBe('2025-01-01T10:45:00.000Z');

    store.updateSettings({ cameraTimeOffsets: { cam5: 0 } });
    store.reapplyTimeSettings();
    expect(store.getClip('c5')!.recordedAt).toBe('2025-01-01T10:00:00.000Z');
  });
});

describe('読めない保存先(OneDrive 等のデータレス/破損)でも本物を壊さない', () => {
  it('isDatalessPlaceholder: サイズ>0 かつブロック=0(スパース) を検知する', () => {
    // ftruncate で「論理サイズは大きいが実体ブロック=0」のスパースファイルを作る
    // (= OneDrive のオンラインのみプレースホルダと同じ stat になる)
    const fd = fs.openSync(projectFile, 'w');
    fs.ftruncateSync(fd, 260470);
    fs.closeSync(fd);
    expect(isDatalessPlaceholder(projectFile)).toBe(true);
  });

  it('isDatalessPlaceholder: 実体のある通常ファイルは false / 無いファイルも false', () => {
    fs.writeFileSync(projectFile, JSON.stringify({ version: 2, days: [] }));
    expect(isDatalessPlaceholder(projectFile)).toBe(false);
    expect(isDatalessPlaceholder(path.join(dir, 'nope.json'))).toBe(false);
  });

  it('データレスな project.json は ProjectUnreadableError を投げる(空で上書きしない)', () => {
    const fd = fs.openSync(projectFile, 'w');
    fs.ftruncateSync(fd, 260470);
    fs.closeSync(fd);
    const before = fs.statSync(projectFile);
    expect(() => ProjectStore.load({ projectFile, backupsDir, saveDebounceMs: 0 })).toThrow(
      ProjectUnreadableError,
    );
    // 本物(サイズ)を空データで書き潰していないこと
    expect(fs.statSync(projectFile).size).toBe(before.size);
  });

  it('壊れた JSON も ProjectUnreadableError を投げる', () => {
    fs.writeFileSync(projectFile, '{ this is not json ');
    expect(() => ProjectStore.load({ projectFile, backupsDir, saveDebounceMs: 0 })).toThrow(
      ProjectUnreadableError,
    );
  });
});
