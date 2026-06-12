import { describe, expect, it } from 'vitest';
import { parseFrameRate, parseProbeJson } from './ffprobe.js';

describe('parseFrameRate', () => {
  it('分数表記を数値化する', () => {
    expect(parseFrameRate('30000/1001')).toBeCloseTo(29.97, 2);
  });
  it('整数表記', () => {
    expect(parseFrameRate('30/1')).toBe(30);
  });
  it('0 除算は null', () => {
    expect(parseFrameRate('0/0')).toBeNull();
  });
  it('undefined は null', () => {
    expect(parseFrameRate(undefined)).toBeNull();
  });
});

describe('parseProbeJson', () => {
  it('h264 + aac は playableInBrowser=true', () => {
    const meta = parseProbeJson({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30000/1001',
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: {
        duration: '123.45',
        tags: { creation_time: '2025-01-01T10:00:00.000000Z' },
      },
    });
    expect(meta.videoCodec).toBe('h264');
    expect(meta.audioCodec).toBe('aac');
    expect(meta.width).toBe(1920);
    expect(meta.durationSec).toBeCloseTo(123.45);
    expect(meta.playableInBrowser).toBe(true);
    expect(meta.createdAt).toBe('2025-01-01T10:00:00.000Z');
  });

  it('hevc は playableInBrowser=false', () => {
    const meta = parseProbeJson({
      streams: [{ codec_type: 'video', codec_name: 'hevc' }],
      format: { duration: '10' },
    });
    expect(meta.playableInBrowser).toBe(false);
    expect(meta.createdAt).toBeNull();
  });

  it('音声なし h264 は playableInBrowser=true', () => {
    const meta = parseProbeJson({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
      format: { duration: '10' },
    });
    expect(meta.audioCodec).toBeNull();
    expect(meta.playableInBrowser).toBe(true);
  });

  it('format.duration が無ければ video stream の duration を使う', () => {
    const meta = parseProbeJson({
      streams: [{ codec_type: 'video', codec_name: 'h264', duration: '55.5' }],
      format: {},
    });
    expect(meta.durationSec).toBeCloseTo(55.5);
  });
});
