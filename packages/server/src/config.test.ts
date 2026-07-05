import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'veh-cfg-'));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('loadConfig のディレクトリ配置', () => {
  it('既定では cache 一式が projectDir/cache 配下(後方互換)', () => {
    const proj = tmp();
    const c = loadConfig({ VEH_PROJECT_DIR: proj });
    expect(c.thumbsDir).toBe(path.join(proj, 'cache', 'thumbs'));
    expect(c.proxiesDir).toBe(path.join(proj, 'cache', 'proxies'));
    expect(c.transcriptsDir).toBe(path.join(proj, 'cache', 'transcripts'));
    expect(c.scenesDir).toBe(path.join(proj, 'cache', 'scenes'));
    expect(c.vadDir).toBe(path.join(proj, 'cache', 'vad'));
  });

  it('VEH_CACHE_DIR 指定時: 大容量(サムネ/プロキシ)だけローカルへ分離し、解析結果(文字起こし/シーン/VAD)と project.json は projectDir 側に残す', () => {
    const proj = tmp();
    const cache = tmp();
    const c = loadConfig({ VEH_PROJECT_DIR: proj, VEH_CACHE_DIR: cache });
    // 同期したくない大容量 → ローカルの cache 側
    expect(c.thumbsDir).toBe(path.join(cache, 'thumbs'));
    expect(c.proxiesDir).toBe(path.join(cache, 'proxies'));
    // 同期したい解析結果 → projectDir 側(OneDrive 等に同期される)
    expect(c.transcriptsDir).toBe(path.join(proj, 'cache', 'transcripts'));
    expect(c.scenesDir).toBe(path.join(proj, 'cache', 'scenes'));
    expect(c.vadDir).toBe(path.join(proj, 'cache', 'vad'));
    // 手動データも projectDir 側
    expect(c.projectFile).toBe(path.join(proj, 'project.json'));
    expect(c.backupsDir).toBe(path.join(proj, 'backups'));
  });
});
