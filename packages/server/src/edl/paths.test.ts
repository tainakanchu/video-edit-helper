import { describe, expect, it } from 'vitest';
import { resolveEdlPath } from './paths.js';

function existsIn(paths: string[]): (p: string) => boolean {
  const set = new Set(paths);
  return (p) => set.has(p);
}

describe('resolveEdlPath', () => {
  it('posix では /mnt をそのまま使う', () => {
    const got = resolveEdlPath(['/mnt/d/movie raw/環島/a.mp4'], {
      platform: 'linux',
      exists: existsIn(['/mnt/d/movie raw/環島/a.mp4']),
      rewrites: [],
      wslDistro: '',
    });
    expect(got).toBe('/mnt/d/movie raw/環島/a.mp4');
  });

  it('posix では Windows パスを /mnt に変換する', () => {
    const got = resolveEdlPath(['D:\\foo\\a.mp4'], {
      platform: 'linux',
      exists: existsIn(['/mnt/d/foo/a.mp4']),
      rewrites: [],
      wslDistro: '',
    });
    expect(got).toBe('/mnt/d/foo/a.mp4');
  });

  it('posix では \\\\wsl$\\...\\home を /home にする', () => {
    const got = resolveEdlPath(['\\\\wsl$\\Ubuntu\\home\\u\\a.mp4'], {
      platform: 'linux',
      exists: existsIn(['/home/u/a.mp4']),
      rewrites: [],
      wslDistro: '',
    });
    expect(got).toBe('/home/u/a.mp4');
  });

  it('win32 では /mnt/c を C:\\ にする', () => {
    const got = resolveEdlPath(['/mnt/c/foo/a.mp4'], {
      platform: 'win32',
      exists: existsIn(['C:\\foo\\a.mp4']),
      rewrites: [],
      wslDistro: '',
    });
    expect(got).toBe('C:\\foo\\a.mp4');
  });

  it('win32 では /home を \\\\wsl$\\<distro> にする', () => {
    const got = resolveEdlPath(['/home/u/a.mp4'], {
      platform: 'win32',
      exists: existsIn(['\\\\wsl$\\Ubuntu\\home\\u\\a.mp4']),
      rewrites: [],
      wslDistro: 'Ubuntu',
    });
    expect(got).toBe('\\\\wsl$\\Ubuntu\\home\\u\\a.mp4');
  });

  it('前方一致の置換が効く', () => {
    const got = resolveEdlPath(['/mnt/d/movie/a.mp4'], {
      platform: 'linux',
      exists: existsIn(['/data/movie/a.mp4']),
      rewrites: [{ from: '/mnt/d/movie', to: '/data/movie' }],
      wslDistro: '',
    });
    expect(got).toBe('/data/movie/a.mp4');
  });

  it('どちらも無ければ null', () => {
    const got = resolveEdlPath(['/nope/a.mp4', 'Z:\\nope\\a.mp4'], {
      platform: 'linux',
      exists: () => false,
      rewrites: [],
      wslDistro: '',
    });
    expect(got).toBeNull();
  });

  it('空候補は null', () => {
    expect(
      resolveEdlPath(['', '  '], {
        platform: 'linux',
        exists: () => true,
        rewrites: [],
        wslDistro: '',
      }),
    ).toBeNull();
  });
});
