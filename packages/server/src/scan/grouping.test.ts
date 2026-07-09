import { describe, expect, it } from 'vitest';
import type { Clip, ProjectSettings } from '@veh/shared';
import {
  buildDays,
  buildDaysAndClips,
  cameraLabelOf,
  clipIdOf,
  dayIdOf,
  fileFingerprint,
  fileIdOf,
  recordedAtOf,
  splitNumberedName,
  type FingerprintInput,
  type ProbedFile,
} from './grouping.js';

const settings: ProjectSettings = {
  mediaRoots: ['/media'],
  dayStartHour: 4,
  thumbCoarseIntervalSec: 60,
  thumbFineIntervalSec: 10,
  proxyAllFiles: false,
};

const GB = 1024 * 1024 * 1024;

function file(p: Partial<ProbedFile> & { path: string; fileName: string }): ProbedFile {
  return {
    dir: '/media/cam',
    mediaRoot: '/media',
    storedRoot: '/media',
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
    gps: null,
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

describe('Clip.gps(代表撮影位置)', () => {
  it('GPS を持つ最初のファイルの値をクリップに反映する', () => {
    const files = [
      file({
        path: '/media/cam/G_0001.MP4',
        fileName: 'G_0001.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
        gps: null,
      }),
      file({
        path: '/media/cam/G_0002.MP4',
        fileName: 'G_0002.MP4',
        sizeBytes: 3 * GB,
        durationSec: 600,
        gps: { lat: 35.0421, lon: 135.7556 },
      }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.gps).toEqual({ lat: 35.0421, lon: 135.7556 });
  });

  it('全ファイルが GPS を持たなければ null', () => {
    const files = [
      file({ path: '/media/cam/H_0001.MP4', fileName: 'H_0001.MP4', gps: null }),
    ];
    const { clips } = buildDaysAndClips(files, settings);
    expect(clips[0]!.gps).toBeNull();
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
  it('clipId は指紋の sha1 先頭 12 文字', () => {
    const fp: FingerprintInput = {
      fileName: 'F_0001.MP4',
      sizeBytes: 3 * GB,
      durationSec: 600,
      createdAt: null,
    };
    expect(clipIdOf(fp)).toHaveLength(12);
  });
});

describe('buildDays(Day 構築部分を抽出した純関数)', () => {
  function clip(overrides: Partial<Clip> & { id: string; dayId: string; recordedAt: string }): Clip {
    return {
      name: `${overrides.id}.MP4`,
      cameraLabel: 'cam',
      files: [],
      durationSec: 60,
      reviewStatus: 'unreviewed',
      watchedRanges: [],
      ...overrides,
    };
  }

  it('dayId ごとに集約し日付昇順で index を振る(buildDaysAndClips と同じ結果)', () => {
    const clips = [
      clip({ id: 'a', dayId: '2025-01-03', recordedAt: '2025-01-03T10:00:00.000Z' }),
      clip({ id: 'b', dayId: '2025-01-01', recordedAt: '2025-01-01T10:00:00.000Z' }),
    ];
    const days = buildDays(clips);
    expect(days.map((d) => [d.date, d.index])).toEqual([
      ['2025-01-01', 1],
      ['2025-01-03', 2],
    ]);
  });

  it('同一 Day 内は recordedAt 昇順(同時刻はクリップ名で安定化)', () => {
    const clips = [
      clip({ id: 'z', dayId: '2025-01-01', recordedAt: '2025-01-01T09:00:00.000Z' }),
      clip({ id: 'a', dayId: '2025-01-01', recordedAt: '2025-01-01T09:00:00.000Z' }),
    ];
    const days = buildDays(clips);
    expect(days).toHaveLength(1);
    expect(days[0]!.clipIds).toEqual(['a', 'z']);
  });
});

describe('指紋方式の ID(パス非依存・内容固有)', () => {
  const base: FingerprintInput = {
    fileName: 'VCAM_0032.MP4',
    sizeBytes: 12_582_912,
    durationSec: 2.5,
    createdAt: '2026-04-19T03:05:39.000Z',
  };

  it('fileFingerprint は決定的で、同じ内容フィールドなら同じ文字列', () => {
    const a = { ...base };
    const b = { ...base };
    expect(fileFingerprint(a)).toBe(fileFingerprint(b));
    // durationSec は ms 精度に量子化される(0.5ms 未満の揺れは無視)
    expect(fileFingerprint({ ...base, durationSec: 2.5004 })).toBe(fileFingerprint(base));
  });

  it('パス非依存: 指紋には path を渡さないので、どこへ移動しても同じ id', () => {
    // 同一の (fileName, size, duration, createdAt) からは常に同じ id が出る
    expect(fileIdOf({ ...base })).toBe(fileIdOf({ ...base }));
    expect(clipIdOf({ ...base })).toBe(clipIdOf({ ...base }));
  });

  it('createdAt=null でも安定した id を返す', () => {
    const nullish: FingerprintInput = { ...base, createdAt: null };
    expect(fileIdOf(nullish)).toBe(fileIdOf({ ...nullish }));
    expect(fileIdOf(nullish)).toHaveLength(12);
  });

  it('sizeBytes / durationSec / fileName / createdAt が違えば別 id', () => {
    const id = fileIdOf(base);
    expect(fileIdOf({ ...base, sizeBytes: base.sizeBytes + 1 })).not.toBe(id);
    expect(fileIdOf({ ...base, durationSec: base.durationSec + 1 })).not.toBe(id);
    expect(fileIdOf({ ...base, fileName: 'VCAM_0033.MP4' })).not.toBe(id);
    expect(fileIdOf({ ...base, createdAt: null })).not.toBe(id);
  });

  it('fileIdOf と clipIdOf は同じ入力でも接頭辞で名前空間が分かれる', () => {
    expect(fileIdOf(base)).not.toBe(clipIdOf(base));
  });
});

describe('カメラ別 時刻補正 (cameraTimeOffsets)', () => {
  const files = [
    file({
      path: '/media/vlog/A.MP4',
      fileName: 'A.MP4',
      dir: '/media/vlog',
      createdAt: '2025-05-01T20:00:00.000Z',
    }),
    file({
      path: '/media/xiaomi/B.MP4',
      fileName: 'B.MP4',
      dir: '/media/xiaomi',
      createdAt: '2025-05-01T20:00:00.000Z',
    }),
  ];

  it('cameraLabel ごとの補正分だけ recordedAt をずらす(他機器は不変)', () => {
    const withOffset: ProjectSettings = { ...settings, cameraTimeOffsets: { vlog: 60 } };
    const { clips } = buildDaysAndClips(files, withOffset);
    const vlog = clips.find((c) => c.cameraLabel === 'vlog')!;
    const xiaomi = clips.find((c) => c.cameraLabel === 'xiaomi')!;
    expect(vlog.recordedAt).toBe('2025-05-01T21:00:00.000Z'); // +60分
    expect(xiaomi.recordedAt).toBe('2025-05-01T20:00:00.000Z'); // 補正なし
  });

  it('負の補正も効く', () => {
    const withOffset: ProjectSettings = { ...settings, cameraTimeOffsets: { vlog: -90 } };
    const { clips } = buildDaysAndClips(files, withOffset);
    const vlog = clips.find((c) => c.cameraLabel === 'vlog')!;
    expect(vlog.recordedAt).toBe('2025-05-01T18:30:00.000Z'); // -90分
  });

  it('未設定(既定)は recordedAt を変えない', () => {
    const { clips } = buildDaysAndClips(files, settings);
    const vlog = clips.find((c) => c.cameraLabel === 'vlog')!;
    expect(vlog.recordedAt).toBe('2025-05-01T20:00:00.000Z');
  });
});

describe('素材ルート別 時刻補正 (rootTimeOffsets)', () => {
  // 同一ルート(/media/hdd)配下に複数サブフォルダ(カメラ)がぶら下がる HDD 構成を模す
  const filesUnderRoot = [
    file({
      path: '/media/hdd/2025-05-01/A.MP4',
      fileName: 'A.MP4',
      dir: '/media/hdd/2025-05-01',
      mediaRoot: '/media/hdd',
      storedRoot: '/media/hdd',
      createdAt: '2025-05-01T20:00:00.000Z',
    }),
    file({
      path: '/media/hdd/2025-05-02/B.MP4',
      fileName: 'B.MP4',
      dir: '/media/hdd/2025-05-02',
      mediaRoot: '/media/hdd',
      storedRoot: '/media/hdd',
      createdAt: '2025-05-02T09:00:00.000Z',
    }),
  ];
  // 別ルート配下のファイル(補正が効かないことの対照用)
  const fileUnderOtherRoot = file({
    path: '/media/ssd/2025-05-01/C.MP4',
    fileName: 'C.MP4',
    dir: '/media/ssd/2025-05-01',
    mediaRoot: '/media/ssd',
    storedRoot: '/media/ssd',
    createdAt: '2025-05-01T20:00:00.000Z',
  });

  it('ルート配下の全カメラ(複数サブフォルダ)の recordedAt に効く(他ルートは不変)', () => {
    const withOffset: ProjectSettings = {
      ...settings,
      rootTimeOffsets: { '/media/hdd': 60 },
    };
    const { clips } = buildDaysAndClips([...filesUnderRoot, fileUnderOtherRoot], withOffset);
    const a = clips.find((c) => c.name === 'A.MP4')!;
    const b = clips.find((c) => c.name === 'B.MP4')!;
    const c = clips.find((c) => c.name === 'C.MP4')!;
    expect(a.recordedAt).toBe('2025-05-01T21:00:00.000Z'); // +60分
    expect(b.recordedAt).toBe('2025-05-02T10:00:00.000Z'); // +60分
    expect(c.recordedAt).toBe('2025-05-01T20:00:00.000Z'); // 別ルートは補正なし
  });

  it('同じ素材に cameraTimeOffsets があればそちらが優先(加算されない)', () => {
    // A.MP4 の cameraLabel は '2025-05-01'(mediaRoot 直下のサブフォルダ名)
    const withBoth: ProjectSettings = {
      ...settings,
      cameraTimeOffsets: { '2025-05-01': 30 },
      rootTimeOffsets: { '/media/hdd': 60 },
    };
    const { clips } = buildDaysAndClips(filesUnderRoot, withBoth);
    const a = clips.find((c) => c.name === 'A.MP4')!;
    const b = clips.find((c) => c.name === 'B.MP4')!;
    // A は cameraTimeOffsets(+30分)が優先。rootTimeOffsets(+60分)とは加算されない
    expect(a.recordedAt).toBe('2025-05-01T20:30:00.000Z');
    // B は cameraLabel が対象外のため rootTimeOffsets(+60分)が適用される
    expect(b.recordedAt).toBe('2025-05-02T10:00:00.000Z');
  });

  it('どちらも未設定なら recordedAt は不変', () => {
    const { clips } = buildDaysAndClips(filesUnderRoot, settings);
    const a = clips.find((c) => c.name === 'A.MP4')!;
    expect(a.recordedAt).toBe('2025-05-01T20:00:00.000Z');
  });
});
