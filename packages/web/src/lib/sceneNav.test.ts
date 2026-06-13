import { describe, expect, it } from 'vitest';
import { nextSceneTime, prevSceneTime } from './sceneNav';

const SCENES = [10, 25, 40, 60];

describe('prevSceneTime', () => {
  it('途中からは直前の転換点へ', () => {
    expect(prevSceneTime(SCENES, 30)).toBe(25);
    expect(prevSceneTime(SCENES, 41)).toBe(40);
    expect(prevSceneTime(SCENES, 1000)).toBe(60);
  });

  it('先頭の転換点より前は 0 へ', () => {
    expect(prevSceneTime(SCENES, 5)).toBe(0);
    expect(prevSceneTime(SCENES, 0)).toBe(0);
  });

  it('ちょうど転換点上ならさらに 1 つ前へ', () => {
    expect(prevSceneTime(SCENES, 25)).toBe(10);
    expect(prevSceneTime(SCENES, 10)).toBe(0);
    expect(prevSceneTime(SCENES, 60)).toBe(40);
  });

  it('転換点が空なら 0', () => {
    expect(prevSceneTime([], 30)).toBe(0);
  });
});

describe('nextSceneTime', () => {
  it('途中からは直後の転換点へ', () => {
    expect(nextSceneTime(SCENES, 5)).toBe(10);
    expect(nextSceneTime(SCENES, 30)).toBe(40);
    expect(nextSceneTime(SCENES, 0)).toBe(10);
  });

  it('最後の転換点より後は最後へクランプ', () => {
    expect(nextSceneTime(SCENES, 100)).toBe(60);
    expect(nextSceneTime(SCENES, 60)).toBe(60);
  });

  it('ちょうど転換点上ならさらに 1 つ先へ', () => {
    expect(nextSceneTime(SCENES, 10)).toBe(25);
    expect(nextSceneTime(SCENES, 40)).toBe(60);
  });

  it('転換点が空なら現在時刻を維持', () => {
    expect(nextSceneTime([], 30)).toBe(30);
  });
});
