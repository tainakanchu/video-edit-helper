import { describe, expect, it } from 'vitest';
import { edlKeyAction } from './edlKeys';

const bare = { shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };

describe('edlKeyAction', () => {
  it('再生と速度', () => {
    expect(edlKeyAction({ ...bare, key: ' ' })).toEqual({ type: 'toggle' });
    expect(edlKeyAction({ ...bare, key: 'k' })).toEqual({ type: 'toggle' });
    expect(edlKeyAction({ ...bare, key: 'j' })).toEqual({ type: 'rate', dir: -1 });
    expect(edlKeyAction({ ...bare, key: 'L' })).toEqual({ type: 'rate', dir: 1 });
  });

  it('矢印は区間、Shift で 10 秒', () => {
    expect(edlKeyAction({ ...bare, key: 'ArrowRight' })).toEqual({ type: 'segment', dir: 1 });
    expect(edlKeyAction({ ...bare, key: 'ArrowLeft', shiftKey: true })).toEqual({
      type: 'skip',
      delta: -10,
    });
  });

  it('修飾キー付きは奪わない。上下単体は何もしない', () => {
    expect(edlKeyAction({ ...bare, key: 'k', metaKey: true })).toBeNull();
    expect(edlKeyAction({ ...bare, key: 'ArrowUp' })).toBeNull();
    expect(edlKeyAction({ ...bare, key: 'ArrowDown', shiftKey: true })).toEqual({
      type: 'gain',
      delta: -0.25,
    });
  });

  it('章・コメント・ヘルプ', () => {
    expect(edlKeyAction({ ...bare, key: ']' })).toEqual({ type: 'chapter', dir: 1 });
    expect(edlKeyAction({ ...bare, key: 'n' })).toEqual({ type: 'comment' });
    expect(edlKeyAction({ ...bare, key: '?' })).toEqual({ type: 'help' });
    expect(edlKeyAction({ ...bare, key: 'Escape' })).toEqual({ type: 'escape' });
  });
});
