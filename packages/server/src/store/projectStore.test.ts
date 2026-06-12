import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clip, Day } from '@veh/shared';
import { ProjectStore } from './projectStore.js';

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

const day: Day = { id: '2025-01-01', date: '2025-01-01', index: 1, clipIds: ['c1'] };

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
    store.replaceScanResult([day], [mkClip('c1')]);
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
    store.replaceScanResult([day], [mkClip('c1')]);
    store.setReviewStatus('c1', 'reviewed');
    store.addWatchedRanges('c1', [{ start: 0, end: 30 }]);

    // 再スキャン: 同じ clipId だが reviewStatus は unreviewed の新規 Clip
    store.replaceScanResult([day], [mkClip('c1', { reviewStatus: 'unreviewed', watchedRanges: [] })]);

    const c = store.getClip('c1')!;
    expect(c.reviewStatus).toBe('reviewed');
    expect(c.watchedRanges).toEqual([{ start: 0, end: 30 }]);
  });

  it('消えたクリップの notes は孤児として保持される', () => {
    const store = newStore();
    store.replaceScanResult([day], [mkClip('c1')]);
    store.createNote('c1', 5, 'メモ', []);

    // 再スキャンで c1 が消える(c2 のみ)
    store.replaceScanResult(
      [{ id: '2025-01-01', date: '2025-01-01', index: 1, clipIds: ['c2'] }],
      [mkClip('c2')],
    );
    expect(store.getClip('c1')).toBeUndefined();
    expect(Object.keys(store.getState().notes)).toHaveLength(1);
  });
});

describe('addWatchedRanges 昇格', () => {
  it('unreviewed は in_progress に昇格', () => {
    const store = newStore();
    store.replaceScanResult([day], [mkClip('c1')]);
    store.addWatchedRanges('c1', [{ start: 0, end: 10 }]);
    expect(store.getClip('c1')!.reviewStatus).toBe('in_progress');
  });

  it('reviewed は昇格させない', () => {
    const store = newStore();
    store.replaceScanResult([day], [mkClip('c1')]);
    store.setReviewStatus('c1', 'reviewed');
    store.addWatchedRanges('c1', [{ start: 0, end: 10 }]);
    expect(store.getClip('c1')!.reviewStatus).toBe('reviewed');
  });
});
