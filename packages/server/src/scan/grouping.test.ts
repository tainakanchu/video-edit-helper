import { describe, expect, it } from 'vitest';
import type { ProjectSettings } from '@veh/shared';
import {
  buildDaysAndClips,
  cameraLabelOf,
  clipIdOf,
  dayIdOf,
  recordedAtOf,
  splitNumberedName,
  type ProbedFile,
} from './grouping.js';

const settings: ProjectSettings = {
  mediaRoots: ['/media'],
  dayStartHour: 4,
  thumbCoarseIntervalSec: 60,
  thumbFineIntervalSec: 10,
};

const GB = 1024 * 1024 * 1024;

function file(p: Partial<ProbedFile> & { path: string; fileName: string }): ProbedFile {
  return {
    dir: '/media/cam',
    mediaRoot: '/media',
    sizeBytes: 100 * 1024 * 1024,
    durationSec: 60,
    createdAt: null,
    mtime: '2025-01-01T12:00:00.000Z',
    width: 1920,
    height: 1080,
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps: 30,
    playableInBrowser: true,
    ...p,
  };
}

describe('splitNumberedName', () => {
  it('数値サフィックスを分解する', () => {
    expect(splitNumberedName('DJI_0012.MP4')).toEqual({ prefix: 'DJI_', num: 12 });
  });
  it('数値が無ければ num=null', () => {
    expect(splitNumberedName('clip.mp4')).toEqual({ prefix: 'clip.mp4', num: null });
  });
});

describe('連番チェーン検出', () => {
  it('① 3GB 上限サイズの連番をチェーン結合する', () => {
    const files = [
      file({
        path: '/media/cam/F_0001.MP4',
        fileName: 'F_0001.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
      }),
      file({
        path: '/media/cam/F_0002.MP4',
        fileName: 'F_0002.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
      }),
      file({
        path: '/media/cam/F_0003.MP4',
        fileName: 'F_0003.MP4',
        sizeBytes: 1 * GB,
        durationSec: 200,
      }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.files).toHaveLength(3);
    expect(clips[0]!.durationSec).toBe(1400);
    // startOffsetSec が累積
    expect(clips[0]!.files.map((f) => f.startOffsetSec)).toEqual([0, 600, 1200]);
  });

  it('② 時刻連鎖で結合する(サイズ小でも)', () => {
    const files = [
      file({
        path: '/media/cam/A_0001.MP4',
        fileName: 'A_0001.MP4',
        sizeBytes: 200 * 1024 * 1024,
        durationSec: 60,
        createdAt: '2025-01-01T10:00:00.000Z',
      }),
      file({
        path: '/media/cam/A_0002.MP4',
        fileName: 'A_0002.MP4',
        sizeBytes: 200 * 1024 * 1024,
        durationSec: 60,
        // 前の終了 10:01:00 とほぼ一致
        createdAt: '2025-01-01T10:01:01.000Z',
      }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.files).toHaveLength(2);
  });

  it('③ 同 prefix 連番でもサイズ小・時刻不連続なら分割', () => {
    const files = [
      file({
        path: '/media/cam/B_0001.MP4',
        fileName: 'B_0001.MP4',
        sizeBytes: 200 * 1024 * 1024,
        durationSec: 60,
        createdAt: '2025-01-01T10:00:00.000Z',
      }),
      file({
        path: '/media/cam/B_0002.MP4',
        fileName: 'B_0002.MP4',
        sizeBytes: 200 * 1024 * 1024,
        durationSec: 60,
        // 前の終了 10:01:00 から 5 分後 → 不連続
        createdAt: '2025-01-01T10:06:00.000Z',
      }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips).toHaveLength(2);
  });

  it('④ 番号飛びで分割', () => {
    const files = [
      file({
        path: '/media/cam/C_0001.MP4',
        fileName: 'C_0001.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
      }),
      file({
        path: '/media/cam/C_0003.MP4',
        fileName: 'C_0003.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
      }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips).toHaveLength(2);
  });

  it('サイズ上限でも最大サイズの 92% 未満なら結合しない', () => {
    // 1 本目が 2GB ちょうど、チェーン最大が 3GB → 2GB/3GB = 0.66 < 0.92
    const files = [
      file({
        path: '/media/cam/D_0001.MP4',
        fileName: 'D_0001.MP4',
        sizeBytes: 2 * GB,
        durationSec: 400,
      }),
      file({
        path: '/media/cam/D_0002.MP4',
        fileName: 'D_0002.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
      }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips).toHaveLength(2);
  });
});

describe('recordedAt 補正', () => {
  it('⑤ createdAt 無し → mtime − duration 補正', () => {
    const f = file({
      path: '/media/cam/E_0001.MP4',
      fileName: 'E_0001.MP4',
      createdAt: null,
      durationSec: 120,
      mtime: '2025-01-01T12:02:00.000Z',
    });
    expect(recordedAtOf(f)).toBe('2025-01-01T12:00:00.000Z');
  });
  it('createdAt があればそれを使う', () => {
    const f = file({
      path: '/media/cam/x.MP4',
      fileName: 'x.MP4',
      createdAt: '2025-01-01T08:00:00.000Z',
    });
    expect(recordedAtOf(f)).toBe('2025-01-01T08:00:00.000Z');
  });
});

describe('⑥ dayStartHour 跨ぎの日付補正', () => {
  it('dayStartHour=4 で 02:30(ローカル)は前日扱い', () => {
    // ローカルタイムで構築するため Date を使って ISO に
    const local = new Date(2025, 2, 10, 2, 30, 0); // 3/10 02:30 ローカル
    expect(dayIdOf(local.toISOString(), 4)).toBe('2025-03-09');
  });
  it('dayStartHour=4 で 05:00(ローカル)は当日扱い', () => {
    const local = new Date(2025, 2, 10, 5, 0, 0);
    expect(dayIdOf(local.toISOString(), 4)).toBe('2025-03-10');
  });
});

describe('⑦ 複数カメラ混在の Day 内時系列ソート', () => {
  it('全カメラを recordedAt 昇順で並べる', () => {
    const files = [
      file({
        path: '/media/feiyu/F_0001.MP4',
        fileName: 'F_0001.MP4',
        dir: '/media/feiyu',
        createdAt: '2025-01-01T10:00:00.000Z',
      }),
      file({
        path: '/media/phone/P_0001.MP4',
        fileName: 'P_0001.MP4',
        dir: '/media/phone',
        createdAt: '2025-01-01T09:00:00.000Z',
      }),
      file({
        path: '/media/feiyu/F_0009.MP4',
        fileName: 'F_0009.MP4',
        dir: '/media/feiyu',
        createdAt: '2025-01-01T11:00:00.000Z',
      }),
    ];
    const { days, clips } = buildDaysAndClips(files, settings);
    expect(days).toHaveLength(1);
    const day = days[0]!;
    // 09:00(phone) → 10:00(feiyu) → 11:00(feiyu) の順
    const ordered = day.clipIds.map((id) => clips.find((c) => c.id === id)!.recordedAt);
    expect(ordered).toEqual([
      '2025-01-01T09:00:00.000Z',
      '2025-01-01T10:00:00.000Z',
      '2025-01-01T11:00:00.000Z',
    ]);
  });
});

describe('cameraLabel', () => {
  it('サブフォルダがあれば先頭セグメント', () => {
    const f = file({
      path: '/media/feiyu/sub/F_0001.MP4',
      fileName: 'F_0001.MP4',
      mediaRoot: '/media',
    });
    expect(cameraLabelOf(f)).toBe('feiyu');
  });
  it('mediaRoot 直下なら mediaRoot のフォルダ名', () => {
    const f = file({
      path: '/media/cam/F_0001.MP4',
      fileName: 'F_0001.MP4',
      mediaRoot: '/media/cam',
    });
    expect(cameraLabelOf(f)).toBe('cam');
  });
});

describe('Day.index と clipId 安定性', () => {
  it('日付昇順で index を振る', () => {
    const files = [
      file({
        path: '/media/cam/a.MP4',
        fileName: 'a.MP4',
        createdAt: '2025-01-03T10:00:00.000Z',
      }),
      file({
        path: '/media/cam/b.MP4',
        fileName: 'b.MP4',
        createdAt: '2025-01-01T10:00:00.000Z',
      }),
    ];
    const { days } = buildDaysAndClips(files, settings);
    expect(days.map((d) => [d.date, d.index])).toEqual([
      ['2025-01-01', 1],
      ['2025-01-03', 2],
    ]);
  });
  it('clipId は先頭ファイル絶対パスの sha1 先頭 12 文字', () => {
    expect(clipIdOf('/media/cam/F_0001.MP4')).toHaveLength(12);
  });
});
