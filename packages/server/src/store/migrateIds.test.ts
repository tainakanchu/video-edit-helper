import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, type Clip, type ProjectState, type SourceFile } from '@veh/shared';
import { clipIdOf, fileIdOf } from '../scan/grouping.js';
import { applyIdRemap, computeIdRemap, migrateCacheDirsSync, type CacheDirs } from './migrateIds.js';

/** 指紋フィールドを持つ SourceFile を作る(id と指紋は独立に指定できる) */
function srcFile(
  id: string,
  o: { fileName: string; sizeBytes?: number; durationSec?: number; createdAt?: string | null },
): SourceFile {
  return {
    id,
    path: `/old/ssd/${o.fileName}`,
    fileName: o.fileName,
    sizeBytes: o.sizeBytes ?? 1000,
    durationSec: o.durationSec ?? 60,
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps: 30,
    createdAt: o.createdAt ?? null,
    mtime: '2025-01-01T00:00:00.000Z',
    startOffsetSec: 0,
    playableInBrowser: true,
  };
}

function clip(id: string, files: SourceFile[], o: Partial<Clip> = {}): Clip {
  return {
    id,
    dayId: '2025-01-01',
    name: files[0]!.fileName,
    cameraLabel: 'cam',
    files,
    durationSec: files.reduce((s, f) => s + f.durationSec, 0),
    recordedAt: '2025-01-01T10:00:00.000Z',
    reviewStatus: 'unreviewed',
    watchedRanges: [],
    ...o,
  };
}

const NOW = '2025-01-01T00:00:00.000Z';

describe('computeIdRemap / applyIdRemap', () => {
  it('パス由来の旧 id を指紋由来へ再マップし、状態を維持する', () => {
    const f1 = srcFile('oldf1', {
      fileName: 'A_0001.MP4',
      sizeBytes: 3_000_000_000,
      durationSec: 600,
      createdAt: '2025-01-01T10:00:00.000Z',
    });
    const c1 = clip('oldc1', [f1], {
      reviewStatus: 'reviewed',
      watchedRanges: [{ start: 0, end: 30 }],
    });
    const state: ProjectState = {
      version: 1,
      settings: { ...defaultSettings },
      days: [{ id: '2025-01-01', date: '2025-01-01', index: 1, clipIds: ['oldc1'] }],
      clips: { oldc1: c1 },
      notes: {
        n1: {
          id: 'n1',
          clipId: 'oldc1',
          timeSec: 5,
          text: 'メモ',
          tags: ['t'],
          status: 'open',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      selections: {
        s1: {
          id: 's1',
          clipId: 'oldc1',
          inSec: 1,
          outSec: 2,
          text: '',
          tags: [],
          rating: 0,
          noteId: 'n1',
          orderKey: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    };

    const newClipId = clipIdOf(f1);
    const newFileId = fileIdOf(f1);

    const maps = computeIdRemap(state);
    expect(maps.changed).toBe(true);
    expect(maps.clipIdMap.get('oldc1')).toBe(newClipId);
    expect(maps.fileIdMap.get('oldf1')).toBe(newFileId);

    const next = applyIdRemap(state, maps);
    // clips が新 clipId でキー化され、id / file.id が差し替わる
    expect(Object.keys(next.clips)).toEqual([newClipId]);
    expect(next.clips[newClipId]!.id).toBe(newClipId);
    expect(next.clips[newClipId]!.files[0]!.id).toBe(newFileId);
    // reviewStatus / watchedRanges は維持
    expect(next.clips[newClipId]!.reviewStatus).toBe('reviewed');
    expect(next.clips[newClipId]!.watchedRanges).toEqual([{ start: 0, end: 30 }]);
    // days / notes / selections の clipId 再マップ
    expect(next.days[0]!.clipIds).toEqual([newClipId]);
    expect(next.notes.n1!.clipId).toBe(newClipId);
    expect(next.selections.s1!.clipId).toBe(newClipId);
    // selection.id / noteId は不変
    expect(next.selections.s1!.id).toBe('s1');
    expect(next.selections.s1!.noteId).toBe('n1');
    // version = 2
    expect(next.version).toBe(2);

    // 入力 state を破壊しない(純関数)
    expect(state.version).toBe(1);
    expect(state.clips.oldc1).toBeDefined();
    expect(state.clips.oldc1!.id).toBe('oldc1');
    expect(state.notes.n1!.clipId).toBe('oldc1');
  });

  it('孤児 note(対応する clip 無し)は clipId 据え置きで温存', () => {
    const state: ProjectState = {
      version: 1,
      settings: { ...defaultSettings },
      days: [],
      clips: {},
      notes: {
        orphan: {
          id: 'orphan',
          clipId: 'gone-clip',
          timeSec: 1,
          text: 'x',
          tags: [],
          status: 'open',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      selections: {},
    };
    const maps = computeIdRemap(state);
    const next = applyIdRemap(state, maps);
    expect(next.notes.orphan!.clipId).toBe('gone-clip');
  });

  it('冪等: 既に指紋一致な v2 state は changed=false・applyIdRemap は恒等', () => {
    const fields = { fileName: 'B_0001.MP4', sizeBytes: 2000, durationSec: 120, createdAt: null };
    const fid = fileIdOf(fields);
    const cid = clipIdOf(fields);
    const c1 = clip(cid, [srcFile(fid, fields)]);
    const state: ProjectState = {
      version: 2,
      settings: { ...defaultSettings },
      days: [{ id: '2025-01-01', date: '2025-01-01', index: 1, clipIds: [cid] }],
      clips: { [cid]: c1 },
      notes: {},
      selections: {},
    };

    const maps = computeIdRemap(state);
    expect(maps.changed).toBe(false);

    // applyIdRemap は(値として)恒等
    const next = applyIdRemap(state, maps);
    expect(next).toEqual(state);
    // ただし新しいオブジェクトである(入力非破壊)
    expect(next).not.toBe(state);
  });

  it('衝突: 同一指紋の 2 クリップは統合され、両者の notes が生存側に寄る', () => {
    const fields = {
      fileName: 'C_0001.MP4',
      sizeBytes: 5000,
      durationSec: 30,
      createdAt: '2025-02-02T00:00:00.000Z',
    };
    const cA = clip('oldcA', [srcFile('oldfA', fields)]);
    const cB = clip('oldcB', [srcFile('oldfB', fields)]);
    const state: ProjectState = {
      version: 1,
      settings: { ...defaultSettings },
      days: [{ id: '2025-02-02', date: '2025-02-02', index: 1, clipIds: ['oldcA', 'oldcB'] }],
      // 挿入順で A が先 → A が生存
      clips: { oldcA: cA, oldcB: cB },
      notes: {
        nA: {
          id: 'nA',
          clipId: 'oldcA',
          timeSec: 1,
          text: 'A',
          tags: [],
          status: 'open',
          createdAt: NOW,
          updatedAt: NOW,
        },
        nB: {
          id: 'nB',
          clipId: 'oldcB',
          timeSec: 2,
          text: 'B',
          tags: [],
          status: 'open',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
      selections: {},
    };

    const newId = clipIdOf(fields);
    const maps = computeIdRemap(state);
    expect(maps.clipIdMap.get('oldcA')).toBe(newId);
    expect(maps.clipIdMap.get('oldcB')).toBe(newId);

    const next = applyIdRemap(state, maps);
    // 生存クリップは 1 つに統合
    expect(Object.keys(next.clips)).toEqual([newId]);
    // notes は両方 survivor の clipId に寄る
    expect(next.notes.nA!.clipId).toBe(newId);
    expect(next.notes.nB!.clipId).toBe(newId);
    // days は重複除去で 1 つ
    expect(next.days[0]!.clipIds).toEqual([newId]);
  });
});

describe('migrateCacheDirsSync', () => {
  let root: string;
  let dirs: CacheDirs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-cache-'));
    dirs = {
      thumbsDir: path.join(root, 'thumbs'),
      vadDir: path.join(root, 'vad'),
      transcriptsDir: path.join(root, 'transcripts'),
      scenesDir: path.join(root, 'scenes'),
      proxiesDir: path.join(root, 'proxies'),
    };
    for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('thumbs ディレクトリ・vad/transcripts/scenes の json・proxies の mp4 を rename', () => {
    fs.mkdirSync(path.join(dirs.thumbsDir, 'oldc'));
    fs.writeFileSync(path.join(dirs.thumbsDir, 'oldc', 'f.jpg'), 'x');
    fs.writeFileSync(path.join(dirs.vadDir, 'oldc.json'), '{}');
    fs.writeFileSync(path.join(dirs.transcriptsDir, 'oldc.json'), '{}');
    fs.writeFileSync(path.join(dirs.scenesDir, 'oldc.json'), '{}');
    fs.writeFileSync(path.join(dirs.proxiesDir, 'oldf.mp4'), 'x');

    migrateCacheDirsSync(dirs, {
      clipIdMap: new Map([['oldc', 'newc']]),
      fileIdMap: new Map([['oldf', 'newf']]),
      changed: true,
    });

    expect(fs.existsSync(path.join(dirs.thumbsDir, 'newc', 'f.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.thumbsDir, 'oldc'))).toBe(false);
    expect(fs.existsSync(path.join(dirs.vadDir, 'newc.json'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.transcriptsDir, 'newc.json'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.scenesDir, 'newc.json'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.proxiesDir, 'newf.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.proxiesDir, 'oldf.mp4'))).toBe(false);
  });

  it('old===new はスキップ、old 不在もスキップ(何も壊さない)', () => {
    fs.writeFileSync(path.join(dirs.vadDir, 'same.json'), '{}');
    migrateCacheDirsSync(dirs, {
      clipIdMap: new Map([
        ['same', 'same'], // 同一 → スキップ
        ['missing', 'newmiss'], // old 不在 → スキップ
      ]),
      fileIdMap: new Map(),
      changed: false,
    });
    expect(fs.existsSync(path.join(dirs.vadDir, 'same.json'))).toBe(true);
    expect(fs.existsSync(path.join(dirs.vadDir, 'newmiss.json'))).toBe(false);
  });
});
