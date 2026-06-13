import { describe, expect, it } from 'vitest';
import { parseFrameRate, parseIso6709, parseProbeJson } from './ffprobe.js';

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

describe('parseIso6709', () => {
  it('2D(緯度経度のみ)をパースする', () => {
    expect(parseIso6709('+35.0421+135.7556/')).toEqual({ lat: 35.0421, lon: 135.7556 });
  });
  it('3D(高度付き)は緯度経度の先頭 2 つを取る', () => {
    expect(parseIso6709('+35.0421+135.7556+22.9/')).toEqual({ lat: 35.0421, lon: 135.7556 });
  });
  it('CRS 付きでも緯度経度を取り出す', () => {
    expect(parseIso6709('+35.0421+135.7556+022.900CRSWGS_84/')).toEqual({
      lat: 35.0421,
      lon: 135.7556,
    });
  });
  it('負の経度(西半球)', () => {
    expect(parseIso6709('+40.7128-074.0060/')).toEqual({ lat: 40.7128, lon: -74.006 });
  });
  it('不正な文字列は null', () => {
    expect(parseIso6709('not-a-location')).toBeNull();
  });
  it('数値が 1 つだけなら null', () => {
    expect(parseIso6709('+35.0421/')).toBeNull();
  });
  it('範囲外(緯度 > 90)は null', () => {
    expect(parseIso6709('+95.0000+135.7556/')).toBeNull();
  });
  it('範囲外(経度 < -180)は null', () => {
    expect(parseIso6709('+35.0421-200.0000/')).toBeNull();
  });
  it('空文字 / null / undefined は null', () => {
    expect(parseIso6709('')).toBeNull();
    expect(parseIso6709(null)).toBeNull();
    expect(parseIso6709(undefined)).toBeNull();
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
    expect(meta.gps).toBeNull();
  });

  it('location タグから gps を抽出する', () => {
    const meta = parseProbeJson({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
      format: { duration: '10', tags: { location: '+35.0421+135.7556/' } },
    });
    expect(meta.gps).toEqual({ lat: 35.0421, lon: 135.7556 });
  });

  it('location-eng タグからも gps を抽出する', () => {
    const meta = parseProbeJson({
      streams: [{ codec_type: 'video', codec_name: 'h264' }],
      format: { duration: '10', tags: { 'location-eng': '+12.3456+098.7654/' } },
    });
    expect(meta.gps).toEqual({ lat: 12.3456, lon: 98.7654 });
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
