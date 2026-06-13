import { describe, expect, it } from 'vitest';
import { buildPath, parseRoute, routesEqual, type Route } from './router';

describe('parseRoute', () => {
  it('ルートは home', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('')).toEqual({ name: 'home' });
  });

  it('/setup', () => {
    expect(parseRoute('/setup')).toEqual({ name: 'setup' });
  });

  it('/map', () => {
    expect(parseRoute('/map')).toEqual({ name: 'map' });
    expect(parseRoute('/map/')).toEqual({ name: 'map' });
  });

  it('/day/:dayId', () => {
    expect(parseRoute('/day/2024-05-01')).toEqual({ name: 'day', dayId: '2024-05-01' });
  });

  it('/day/:dayId/triage', () => {
    expect(parseRoute('/day/2024-05-01/triage')).toEqual({
      name: 'triage',
      dayId: '2024-05-01',
    });
  });

  it('/clip/:clipId(t なし)', () => {
    expect(parseRoute('/clip/abc123')).toEqual({ name: 'clip', clipId: 'abc123', t: null });
  });

  it('/clip/:clipId?t=秒', () => {
    expect(parseRoute('/clip/abc123', '?t=12.5')).toEqual({
      name: 'clip',
      clipId: 'abc123',
      t: 12.5,
    });
  });

  it('/clip の t が空・非数値なら null', () => {
    expect(parseRoute('/clip/abc', '?t=')).toEqual({ name: 'clip', clipId: 'abc', t: null });
    expect(parseRoute('/clip/abc', '?t=foo')).toEqual({ name: 'clip', clipId: 'abc', t: null });
  });

  it('/clip の t=0 は 0 を保持', () => {
    expect(parseRoute('/clip/abc', '?t=0')).toEqual({ name: 'clip', clipId: 'abc', t: 0 });
  });

  it('/search(q なし)は空文字', () => {
    expect(parseRoute('/search')).toEqual({ name: 'search', q: '' });
  });

  it('/search?q=...(URL エンコード解除)', () => {
    expect(parseRoute('/search', '?q=' + encodeURIComponent('絶景 飯'))).toEqual({
      name: 'search',
      q: '絶景 飯',
    });
  });

  it('末尾スラッシュを正規化', () => {
    expect(parseRoute('/day/d1/')).toEqual({ name: 'day', dayId: 'd1' });
    expect(parseRoute('/setup/')).toEqual({ name: 'setup' });
  });

  it('dayId は URL デコードされる', () => {
    expect(parseRoute('/day/' + encodeURIComponent('2024 05'))).toEqual({
      name: 'day',
      dayId: '2024 05',
    });
  });

  it('不明パスは home', () => {
    expect(parseRoute('/nope')).toEqual({ name: 'home' });
    expect(parseRoute('/day')).toEqual({ name: 'home' });
    expect(parseRoute('/day/d1/foo')).toEqual({ name: 'home' });
    expect(parseRoute('/clip')).toEqual({ name: 'home' });
    expect(parseRoute('/clip/a/b')).toEqual({ name: 'home' });
    expect(parseRoute('/foo/bar/baz')).toEqual({ name: 'home' });
  });
});

describe('buildPath', () => {
  it('各ルートを正しく組み立てる', () => {
    expect(buildPath({ name: 'home' })).toBe('/');
    expect(buildPath({ name: 'setup' })).toBe('/setup');
    expect(buildPath({ name: 'map' })).toBe('/map');
    expect(buildPath({ name: 'day', dayId: 'd1' })).toBe('/day/d1');
    expect(buildPath({ name: 'triage', dayId: 'd1' })).toBe('/day/d1/triage');
    expect(buildPath({ name: 'clip', clipId: 'c1', t: null })).toBe('/clip/c1');
    expect(buildPath({ name: 'clip', clipId: 'c1', t: 12.5 })).toBe('/clip/c1?t=12.5');
    expect(buildPath({ name: 'clip', clipId: 'c1', t: 0 })).toBe('/clip/c1?t=0');
    expect(buildPath({ name: 'search', q: '' })).toBe('/search');
    expect(buildPath({ name: 'search', q: '絶景' })).toBe(
      '/search?q=' + encodeURIComponent('絶景'),
    );
  });

  it('特殊文字を含む ID をエンコードする', () => {
    expect(buildPath({ name: 'day', dayId: '2024 05' })).toBe('/day/2024%2005');
  });
});

describe('round-trip(buildPath → parseRoute)', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'setup' },
    { name: 'map' },
    { name: 'day', dayId: 'd1' },
    { name: 'triage', dayId: 'd1' },
    { name: 'clip', clipId: 'c1', t: null },
    { name: 'clip', clipId: 'c1', t: 30 },
    { name: 'search', q: '' },
    { name: 'search', q: 'hello world' },
  ];

  for (const r of routes) {
    it(`${JSON.stringify(r)} は往復で保たれる`, () => {
      const path = buildPath(r);
      const [pathname, search] = path.split('?');
      expect(parseRoute(pathname!, search ? '?' + search : '')).toEqual(r);
    });
  }
});

describe('routesEqual', () => {
  it('同じ URL を指す Route は等しい', () => {
    expect(routesEqual({ name: 'day', dayId: 'd1' }, { name: 'day', dayId: 'd1' })).toBe(true);
    expect(
      routesEqual({ name: 'clip', clipId: 'c1', t: 5 }, { name: 'clip', clipId: 'c1', t: 5 }),
    ).toBe(true);
  });
  it('異なる URL の Route は等しくない', () => {
    expect(routesEqual({ name: 'day', dayId: 'd1' }, { name: 'day', dayId: 'd2' })).toBe(false);
    expect(routesEqual({ name: 'home' }, { name: 'setup' })).toBe(false);
  });
});
