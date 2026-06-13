import { describe, it, expect } from 'vitest';
import type { Clip, Selection, SourceFile } from '@veh/shared';
import { buildFcpxml } from './fcpxml.js';

function makeFile(id: string, fps: number | null, dur: number, offset: number, w = 1920, h = 1080): SourceFile {
  return {
    id,
    path: `/mnt/c/videos/${id}.MP4`,
    fileName: `${id}.MP4`,
    sizeBytes: 1000,
    durationSec: dur,
    width: w,
    height: h,
    videoCodec: 'h264',
    audioCodec: 'aac',
    fps,
    createdAt: null,
    mtime: '2024-01-01T00:00:00Z',
    startOffsetSec: offset,
    playableInBrowser: false,
  };
}

function makeClip(id: string, files: SourceFile[], recordedAt = '2024-01-01T10:00:00Z'): Clip {
  return {
    id,
    dayId: 'day1',
    name: `Clip ${id}`,
    cameraLabel: 'CAM A',
    files,
    durationSec: files.reduce((s, f) => s + f.durationSec, 0),
    recordedAt,
    reviewStatus: 'unreviewed',
    watchedRanges: [],
  };
}

function makeSel(id: string, clipId: string, inSec: number, outSec: number, text = '', orderKey: number | null = null): Selection {
  return {
    id,
    clipId,
    inSec,
    outSec,
    text,
    tags: [],
    rating: 0,
    noteId: null,
    orderKey,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

describe('buildFcpxml', () => {
  it('単一ファイル選定: 1つの asset-clip', () => {
    const file = makeFile('f1', 30, 120, 0);
    const clip = makeClip('c1', [file]);
    const sel = makeSel('s1', 'c1', 10, 40);
    const clips: Record<string, Clip> = { c1: clip };
    const result = buildFcpxml([sel], id => clips[id], '2024-01-01');

    const assetClipMatches = result.match(/<asset-clip/g);
    expect(assetClipMatches?.length).toBe(1);

    // start=rationalTime(10, 30) = "300/30s", duration=rationalTime(30, 30)="900/30s"
    expect(result).toContain('start="300/30s"');
    expect(result).toContain('duration="900/30s"');

    // 1つの asset, 1つの format
    expect(result.match(/<asset /g)?.length).toBe(1);
    expect(result.match(/<format /g)?.length).toBe(1);
  });

  it('ファイル境界をまたぐ選定: 2つの asset-clip', () => {
    const f0 = makeFile('f0', 30, 60, 0);
    const f1 = makeFile('f1', 30, 60, 60);
    const clip = makeClip('c1', [f0, f1]);
    // 50秒〜70秒 → f0(50〜60) と f1(0〜10)
    const sel = makeSel('s1', 'c1', 50, 70);
    const clips: Record<string, Clip> = { c1: clip };
    const result = buildFcpxml([sel], id => clips[id], '2024-01-01');

    const assetClipMatches = result.match(/<asset-clip/g);
    expect(assetClipMatches?.length).toBe(2);

    // f0 セグメント: start=rationalTime(50,30)="1500/30s", dur=rationalTime(10,30)="300/30s"
    expect(result).toContain('start="1500/30s"');
    // f1 セグメント: start="0s", dur=rationalTime(10,30)="300/30s"
    expect(result).toContain('start="0s"');

    // 2番目の asset-clip の offset = rationalTime(10, seqFps=30) = "300/30s"
    // (スパイン内で2番目の asset-clip の offset 確認)
    const lines = result.split('\n');
    const assetClipLines = lines.filter(l => l.includes('<asset-clip'));
    expect(assetClipLines[1]).toContain('offset="300/30s"');
  });

  it('同じ (fps, w, h) のフォーマットは重複排除される', () => {
    const f1 = makeFile('f1', 30, 60, 0, 1920, 1080);
    const f2 = makeFile('f2', 30, 60, 0, 1920, 1080);
    const c1 = makeClip('c1', [f1], '2024-01-01T10:00:00Z');
    const c2 = makeClip('c2', [f2], '2024-01-01T11:00:00Z');
    const s1 = makeSel('s1', 'c1', 0, 10);
    const s2 = makeSel('s2', 'c2', 0, 10);
    const clips: Record<string, Clip> = { c1, c2 };
    const result = buildFcpxml([s1, s2], id => clips[id], '2024-01-01');

    // format は1つだけ
    expect(result.match(/<format /g)?.length).toBe(1);
  });

  it('orderKey による並び替え: テキスト順が変わる', () => {
    const f1 = makeFile('f1', 30, 60, 0);
    const f2 = makeFile('f2', 30, 60, 0);
    const c1 = makeClip('c1', [f1], '2024-01-01T10:00:00Z');
    const c2 = makeClip('c2', [f2], '2024-01-01T11:00:00Z');
    const clips: Record<string, Clip> = { c1, c2 };

    // s2 に orderKey=0 を付与: 時系列では s1 が先だが、s2 が先頭に来る
    const s1 = makeSel('s1', 'c1', 0, 10, 'first-text');
    const s2 = makeSel('s2', 'c2', 0, 10, 'second-text', 0);

    // orderSelections は buildFcpxml の外で適用済みと仮定
    // ここでは明示的に s2, s1 の順で渡す
    const result = buildFcpxml([s2, s1], id => clips[id], '2024-01-01');

    const noteMatches = result.match(/<note>.*?<\/note>/g);
    expect(noteMatches?.[0]).toContain('second-text');
    expect(noteMatches?.[1]).toContain('first-text');
  });

  it('XML エスケープ: 特殊文字が正しくエスケープされる', () => {
    const file = makeFile('f1', 30, 120, 0);
    const clip = { ...makeClip('c1', [file]), name: 'Tom & Jerry' };
    const sel = makeSel('s1', 'c1', 10, 20, '<tag> & "quoted" \'apos\'');
    const clips: Record<string, Clip> = { c1: clip };
    const result = buildFcpxml([sel], id => clips[id], '2024-01-01');

    // 生の <tag> が存在しない (note 内)
    expect(result).not.toMatch(/<note><tag>/);
    // 生の & が存在しない (エンティティ参照以外)
    const noEntityAmp = result.replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, '');
    expect(noEntityAmp).not.toContain('&');
    // エスケープ済みテキストが存在する
    expect(result).toContain('&lt;tag&gt;');
    expect(result).toContain('Tom &amp; Jerry');
  });

  it('29.97fps: /30000s 分母が使われる', () => {
    const file = makeFile('f1', 29.97, 120, 0);
    const clip = makeClip('c1', [file]);
    const sel = makeSel('s1', 'c1', 1, 2);
    const clips: Record<string, Clip> = { c1: clip };
    const result = buildFcpxml([sel], id => clips[id], '2024-01-01');
    expect(result).toContain('/30000s');
  });

  it('ref 整合性: asset-clip の ref が全て asset id に対応する', () => {
    const file = makeFile('f1', 30, 120, 0);
    const clip = makeClip('c1', [file]);
    const sel = makeSel('s1', 'c1', 10, 40);
    const clips: Record<string, Clip> = { c1: clip };
    const result = buildFcpxml([sel], id => clips[id], '2024-01-01');

    // asset id を収集
    const assetIdMatches = result.matchAll(/<asset id="(a\d+)"/g);
    const assetIds = new Set([...assetIdMatches].map(m => m[1]!));

    // asset-clip ref を収集
    const refMatches = result.matchAll(/ref="(a\d+)"/g);
    const refs = [...refMatches].map(m => m[1]!);

    for (const ref of refs) {
      expect(assetIds.has(ref)).toBe(true);
    }

    // format ref 整合性
    const formatIdMatches = result.matchAll(/<format id="(r\d+)"/g);
    const formatIds = new Set([...formatIdMatches].map(m => m[1]!));

    const formatRefMatches = result.matchAll(/format="(r\d+)"/g);
    const formatRefs = [...formatRefMatches].map(m => m[1]!);

    for (const ref of formatRefs) {
      expect(formatIds.has(ref)).toBe(true);
    }
  });
});
