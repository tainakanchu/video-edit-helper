import { describe, expect, it } from 'vitest';
import { parseEdl } from './parse.js';
import { buildTimeline, resolveAssetFile, type PlanContext } from './plan.js';

function docOf(segments: unknown[], extra: Record<string, unknown> = {}) {
  const r = parseEdl({ durationSec: 100, segments, ...extra });
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

function ctx(exists: Set<string>, over: Partial<PlanContext> = {}): PlanContext {
  return {
    sourceId: 'e1',
    platform: 'linux',
    exists: (p) => exists.has(p),
    cacheDir: '/cache',
    rewrites: [],
    wslDistro: '',
    assetUrl: (role, key) => `/api/edl/e1/asset/${role}/${encodeURIComponent(key)}`,
    ...over,
  };
}

describe('buildTimeline', () => {
  it('中間 mp4 をソースより優先する', () => {
    const doc = docOf([
      { id: 's1', type: 'rt', start: 0, dur: 10, src: '/media/a.mp4', a: 5, b: 15, hasAudio: true },
    ]);
    const tl = buildTimeline(doc, ctx(new Set(['/cache', '/cache/s1.mp4', '/media/a.mp4'])));
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind).toBe('video');
    if (pb?.kind !== 'video') return;
    expect(pb.via).toBe('intermediate');
    expect(pb.mediaStartSec).toBe(0);
    expect(pb.url).toContain('/asset/segment/');
    expect(tl.segments[0]?.realAudio).toBeNull();
  });

  it('中間が無い rt は a から元素材', () => {
    const doc = docOf([
      { id: 's1', type: 'rt', start: 0, dur: 10, src: '/media/a.mp4', a: 5, b: 15 },
    ]);
    const tl = buildTimeline(doc, ctx(new Set(['/media/a.mp4'])));
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind).toBe('video');
    if (pb?.kind !== 'video') return;
    expect(pb.via).toBe('source');
    expect(pb.mediaStartSec).toBe(5);
  });

  it('プロキシ URL は中間が無いときだけ使う', () => {
    const seg = { id: 's1', type: 'rt', start: 0, dur: 10, src: '/media/a.mp4', a: 4 };
    const findProxyUrl = (p: string) => (p === '/media/a.mp4' ? '/api/media/fid/proxy' : null);
    const withProxy = buildTimeline(docOf([seg]), ctx(new Set(['/media/a.mp4']), { findProxyUrl }));
    const pb = withProxy.segments[0]?.playback;
    expect(pb?.kind).toBe('video');
    if (pb?.kind === 'video') {
      expect(pb.via).toBe('proxy');
      expect(pb.url).toBe('/api/media/fid/proxy');
      expect(pb.mediaStartSec).toBe(4);
    }
    const withInter = buildTimeline(
      docOf([seg]),
      ctx(new Set(['/media/a.mp4', '/cache', '/cache/s1.mp4']), { findProxyUrl }),
    );
    const pb2 = withInter.segments[0]?.playback;
    expect(pb2?.kind).toBe('video');
    if (pb2?.kind === 'video') expect(pb2.via).toBe('intermediate');
  });

  it('HL は中間もソースも無ければ理由を返す', () => {
    const doc = docOf([{ id: 'h1', type: 'hl', start: 0, dur: 5, speed: 90, src: '/nope.mp4' }]);
    const tl = buildTimeline(doc, ctx(new Set()));
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind).toBe('placeholder');
    if (pb?.kind === 'placeholder') expect(pb.reason).toBe('HL: 中間ファイルなし');
  });

  it('HL 元素材はブラウザ上限で近似し、real 音は別トラック', () => {
    const doc = docOf([
      {
        id: 'h1',
        type: 'hl',
        start: 0,
        dur: 5,
        speed: 90,
        a: 3,
        src: '/media/h.mp4',
        audio: 'real',
        audioSrc: '/media/aud.mp4',
        audioA: 12,
      },
    ]);
    const tl = buildTimeline(doc, ctx(new Set(['/media/h.mp4', '/media/aud.mp4'])));
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind).toBe('video');
    if (pb?.kind !== 'video') return;
    expect(pb.approximate).toBe(true);
    expect(pb.playbackRate).toBe(16);
    expect(pb.sourceSpeed).toBe(90);
    expect(pb.audible).toBe(false);
    expect(pb.notice).toContain('HL 近似');
    expect(tl.segments[0]?.realAudio?.mediaStartSec).toBe(12);
    expect(tl.segments[0]?.realAudio?.url).toContain('realaudio');
  });

  it('HL 中間があり audio=real なら中間の音を使い realAudio は null', () => {
    const doc = docOf([
      {
        id: 'h1',
        type: 'hl',
        start: 0,
        dur: 5,
        speed: 90,
        src: '/media/h.mp4',
        audio: 'real',
        audioSrc: '/media/aud.mp4',
      },
    ]);
    const tl = buildTimeline(
      doc,
      ctx(new Set(['/cache', '/cache/h1.mp4', '/media/h.mp4', '/media/aud.mp4'])),
    );
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind).toBe('video');
    if (pb?.kind === 'video') {
      expect(pb.via).toBe('intermediate');
      expect(pb.audible).toBe(true);
    }
    expect(tl.segments[0]?.realAudio).toBeNull();
  });

  it('black はカード、欠落した photo と音楽は理由付き', () => {
    const doc = docOf(
      [
        { id: 'b1', type: 'black', start: 0, dur: 2, title: '題', sub: '副' },
        { id: 'p1', type: 'photo', start: 2, dur: 2, src: '/missing.jpg' },
      ],
      { music: [{ id: 'm1', cue: '曲', start: 0, end: 4, trackPath: '/no/music.mp3' }] },
    );
    const tl = buildTimeline(doc, ctx(new Set()));
    expect(tl.segments[0]?.playback.kind).toBe('card');
    const photo = tl.segments[1]?.playback;
    expect(photo?.kind).toBe('placeholder');
    if (photo?.kind === 'placeholder') expect(photo.reason).toBe('画像が見つかりません');
    expect(tl.music[0]?.url).toBeNull();
    expect(tl.music[0]?.missingReason).toContain('音楽');
  });
});

describe('resolveAssetFile', () => {
  it('中間パスを返し、パスに見える未知キーは null', () => {
    const doc = docOf([
      { id: 's1', type: 'rt', start: 0, dur: 10, src: '/media/a.mp4', a: 1 },
    ]);
    const opt = {
      platform: 'linux' as const,
      exists: (p: string) => p === '/cache' || p === '/cache/s1.mp4' || p === '/media/a.mp4',
      rewrites: [],
      wslDistro: '',
    };
    expect(resolveAssetFile(doc, '/cache', 'segment', 's1', opt)).toBe('/cache/s1.mp4');
    expect(resolveAssetFile(doc, '/cache', 'source', 's1', opt)).toBe('/media/a.mp4');
    expect(resolveAssetFile(doc, '/cache', 'segment', '../../etc/passwd', opt)).toBeNull();
    expect(resolveAssetFile(doc, '/cache', 'source', '/etc/passwd', opt)).toBeNull();
  });
});

describe('中間ファイルの付帯情報', () => {
  const rt = { id: 's1', type: 'rt', start: 0, dur: 5, src: '/media/a.mp4', a: 2, b: 7 };
  const sidecar = (meta: unknown) => (p: string) =>
    p === '/cache/s1.mp4.json' ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null;
  const files = new Set(['/cache', '/cache/s1.mp4', '/cache/s1.mp4.json', '/media/a.mp4']);

  it('type と dur（±0.05 秒）が合えば検証済みで中間を使う', () => {
    const tl = buildTimeline(
      docOf([rt]),
      ctx(files, {
        readText: sidecar({ hash: 'h', id: 's1', type: 'rt', dur: 5.04, from: 'x' }),
      }),
    );
    const s = tl.segments[0];
    expect(s?.playback.kind === 'video' && s.playback.via).toBe('intermediate');
    expect(s?.detail).toContain('中間: /cache/s1.mp4');
    expect(s?.detail).not.toContain('未検証');
  });

  it('付帯情報が無ければ中間を使い、未検証と表示する', () => {
    const tl = buildTimeline(
      docOf([rt]),
      ctx(new Set(['/cache', '/cache/s1.mp4', '/media/a.mp4']), { readText: () => null }),
    );
    const s = tl.segments[0];
    expect(s?.playback.kind === 'video' && s.playback.via).toBe('intermediate');
    expect(s?.detail).toContain('未検証');
  });

  it('長さが合わなければ元素材に戻り、理由を出す', () => {
    const tl = buildTimeline(
      docOf([{ ...rt, dur: 4.5 }]),
      ctx(files, { readText: sidecar({ hash: 'h', id: 's1', type: 'rt', dur: 5, from: 'x' }) }),
    );
    const s = tl.segments[0];
    const pb = s?.playback;
    expect(pb?.kind).toBe('video');
    if (pb?.kind !== 'video') return;
    expect(pb.via).toBe('source');
    expect(pb.mediaStartSec).toBe(2);
    expect(pb.notice).toBe('中間ファイルが EDL と合わない（長さ 5.0 / 4.5 秒）');
    expect(s?.detail).toContain('中間ファイルが EDL と合わない（長さ 5.0 / 4.5 秒）');
  });

  it('種類が合わず元素材も無ければ、理由付きのプレースホルダー', () => {
    const tl = buildTimeline(
      docOf([{ id: 'h1', type: 'hl', start: 0, dur: 3, speed: 8 }]),
      ctx(new Set(['/cache', '/cache/h1.mp4', '/cache/h1.mp4.json']), {
        readText: (p) =>
          p === '/cache/h1.mp4.json' ? JSON.stringify({ type: 'rt', dur: 3 }) : null,
      }),
    );
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind).toBe('placeholder');
    if (pb?.kind === 'placeholder') {
      expect(pb.reason).toContain('中間ファイルが EDL と合わない（種類 rt / hl）');
      expect(pb.reason).toContain('HL: 中間ファイルなし');
    }
  });

  it('壊れた付帯情報は使わない', () => {
    const tl = buildTimeline(docOf([rt]), ctx(files, { readText: sidecar('{not json') }));
    const pb = tl.segments[0]?.playback;
    expect(pb?.kind === 'video' && pb.via).toBe('source');
    expect(pb?.kind === 'video' && pb.notice).toBe('中間ファイルの付帯情報が読めない');
  });

  it('resolveAssetFile も合わない中間を配信しない', () => {
    const opt = { platform: 'linux' as const, exists: (p: string) => files.has(p), rewrites: [], wslDistro: '' };
    const ok = sidecar({ type: 'rt', dur: 5 });
    const bad = sidecar({ type: 'rt', dur: 9 });
    expect(resolveAssetFile(docOf([rt]), '/cache', 'segment', 's1', opt, ok)).toBe('/cache/s1.mp4');
    expect(resolveAssetFile(docOf([rt]), '/cache', 'segment', 's1', opt, bad)).toBeNull();
    expect(resolveAssetFile(docOf([rt]), '/cache', 'segment', 's1', opt)).toBe('/cache/s1.mp4');
  });
});
