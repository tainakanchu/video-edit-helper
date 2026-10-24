import { describe, expect, it } from 'vitest';
import { takeTokenFromHash } from './authToken';

describe('takeTokenFromHash', () => {
  it('#veh-token=... からトークンを取り出し、残りのフラグメントを返す', () => {
    expect(takeTokenFromHash('#veh-token=abc_DEF-123')).toEqual({ token: 'abc_DEF-123', rest: '' });
    expect(takeTokenFromHash('#x=1&veh-token=tok')).toEqual({ token: 'tok', rest: 'x=1' });
  });

  it('トークンが無い・空なら null', () => {
    expect(takeTokenFromHash('')).toEqual({ token: null, rest: '' });
    expect(takeTokenFromHash('#veh-token=')).toEqual({ token: null, rest: '' });
    expect(takeTokenFromHash('#section')).toEqual({ token: null, rest: 'section=' });
  });
});
