import { describe, expect, it } from 'vitest';
import { parseTags, rateDown, rateUp } from './keyboard';

describe('parseTags', () => {
  it('#タグ を抽出して本文から除去', () => {
    expect(parseTags('絶景だ #絶景 #台南')).toEqual({
      text: '絶景だ',
      tags: ['絶景', '台南'],
    });
  });
  it('タグ無しは空配列', () => {
    expect(parseTags('ただのメモ')).toEqual({ text: 'ただのメモ', tags: [] });
  });
  it('重複タグは 1 つに', () => {
    expect(parseTags('#飯 美味い #飯').tags).toEqual(['飯']);
  });
  it('タグのみの入力は本文空', () => {
    expect(parseTags('#トラブル')).toEqual({ text: '', tags: ['トラブル'] });
  });
});

describe('rate cycling', () => {
  it('rateUp は次の段階', () => {
    expect(rateUp(1)).toBe(1.25);
    expect(rateUp(1.5)).toBe(2);
    expect(rateUp(3)).toBe(3); // 上限
  });
  it('rateDown は前の段階', () => {
    expect(rateDown(2)).toBe(1.5);
    expect(rateDown(1)).toBe(1); // 下限
  });
  it('段階外の値は最近傍から動く', () => {
    expect(rateUp(1.4)).toBe(2); // 1.5 に丸めて +1
    expect(rateDown(1.1)).toBe(1); // 1 に丸めて -1
  });
});
