import { describe, expect, it } from 'vitest';
import { parseEdl } from './parse.js';

const sample = {
  title: 'ep',
  generatedBy: 'test',
  stops: [],
  notes: ['ignore'],
  fps: 30,
  width: 1280,
  height: 720,
  durationSec: 30,
  chapters: [{ title: '開幕', start: 0 }],
  segments: [
    {
      id: 's1',
      type: 'rt',
      start: 0,
      dur: 10,
      chapter: '開幕',
      note: 'n',
      src: '/mnt/d/a.mp4',
      srcWin: 'D:\\a.mp4',
      a: 1,
      b: 11,
      gainDb: -3,
      hasAudio: true,
      extra: 1,
    },
    { id: 'skip', type: 'rt', start: 10, dur: 0 },
    {
      id: 'h1',
      type: 'hl',
      start: 10,
      dur: 4,
      speed: 90,
      audio: 'real',
      audioA: 3,
      audioSrc: '/mnt/d/aud.mp4',
    },
    { id: 'p1', type: 'photo', start: 14, dur: 2, file: 'a.jpg', src: '/mnt/c/a.jpg', zoom: 'in' },
    {
      id: 'ps',
      type: 'photos',
      start: 16,
      dur: 2,
      files: ['a.jpg', 'b.jpg'],
      srcs: ['/a.jpg', '/b.jpg'],
      gap: 0.8,
    },
    { id: 'b1', type: 'black', start: 18, dur: 2, title: '題', sub: '副' },
    { id: 'c1', type: 'card', start: 20, dur: 2, name: 'day1', src: '/cards/day1.mp4' },
    { id: 'o1', type: 'opener', start: 22, dur: 2, src: '/op.mp4' },
  ],
  music: [
    {
      id: 'm1',
      file: 'a.mp3',
      cue: '曲',
      start: 0,
      end: 10,
      trackIn: 1,
      gainDb: -8,
      fadeIn: 0.3,
      fadeOut: 1,
      duck: true,
      trackPath: 'C:\\Music\\a.mp3',
    },
  ],
  subtitles: [{ start: 1, end: 2, style: 'JA', text: 'こんにちは' }],
  xposts: [{ id: 'x1', start: 3, end: 5, text: 'post', pos: 'center', time: '10:00' }],
};

describe('parseEdl', () => {
  it('各タイプと余分なフィールドを受け付ける', () => {
    const r = parseEdl(sample);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.segments.map((s) => s.id)).toEqual(['s1', 'h1', 'p1', 'ps', 'b1', 'c1', 'o1']);
    expect(r.doc.segments[1]?.speed).toBe(90);
    expect(r.doc.segments[1]?.audio).toBe('real');
    expect(r.doc.music[0]?.duck).toBe(true);
    expect(r.doc.music[0]?.cue).toBe('曲');
    expect(r.doc.subtitles[0]?.style).toBe('JA');
    expect(r.doc.xposts[0]?.pos).toBe('center');
    expect(r.doc.chapters[0]?.title).toBe('開幕');
  });

  it('segments が無いと失敗', () => {
    const r = parseEdl({ title: 'x' });
    expect(r.ok).toBe(false);
  });

  it('dur 0 しか無いと失敗', () => {
    const r = parseEdl({ segments: [{ id: 'a', type: 'rt', start: 0, dur: 0 }] });
    expect(r.ok).toBe(false);
  });

  it('durationSec が無ければ最後の区間から求める', () => {
    const r = parseEdl({
      segments: [{ id: 'a', type: 'black', start: 5, dur: 2, title: 't' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.durationSec).toBe(7);
    expect(r.doc.title).toBe('EDL');
  });
});
