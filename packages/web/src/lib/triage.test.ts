import { describe, expect, it } from 'vitest';
import type { Note } from '@veh/shared';
import {
  advanceProcessed,
  advanceSkip,
  buildTriageQueue,
  currentNoteId,
  doneCount,
  isComplete,
  remainingCount,
} from './triage';

function note(id: string, timeSec: number, status: Note['status'] = 'open'): Note {
  return {
    id,
    clipId: 'c1',
    timeSec,
    text: '',
    tags: [],
    status,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('buildTriageQueue', () => {
  it('open 付箋のみを timeSec 昇順で並べる', () => {
    const q = buildTriageQueue([
      note('b', 30),
      note('a', 10),
      note('p', 20, 'promoted'),
      note('d', 5, 'discarded'),
      note('c', 50),
    ]);
    expect(q.order).toEqual(['a', 'b', 'c']);
    expect(q.index).toBe(0);
    expect(currentNoteId(q)).toBe('a');
  });
  it('open が無ければ空キュー(完了扱い)', () => {
    const q = buildTriageQueue([note('p', 1, 'promoted')]);
    expect(q.order).toEqual([]);
    expect(currentNoteId(q)).toBe(null);
    expect(isComplete(q)).toBe(true);
  });
});

describe('カウント', () => {
  it('remaining / done / complete', () => {
    const q = buildTriageQueue([note('a', 1), note('b', 2), note('c', 3)]);
    expect(remainingCount(q)).toBe(3);
    expect(doneCount(q)).toBe(0);
    expect(isComplete(q)).toBe(false);
  });
});

describe('advanceProcessed(昇格 / 破棄)', () => {
  it('現在を done にして次へ', () => {
    let q = buildTriageQueue([note('a', 1), note('b', 2), note('c', 3)]);
    q = advanceProcessed(q);
    expect(q.done.has('a')).toBe(true);
    expect(currentNoteId(q)).toBe('b');
    expect(remainingCount(q)).toBe(2);
    expect(doneCount(q)).toBe(1);
  });
  it('全部処理すると complete・現在は null', () => {
    let q = buildTriageQueue([note('a', 1), note('b', 2)]);
    q = advanceProcessed(q);
    q = advanceProcessed(q);
    expect(isComplete(q)).toBe(true);
    expect(currentNoteId(q)).toBe(null);
    expect(doneCount(q)).toBe(2);
  });
});

describe('advanceSkip(スキップ = 後回し)', () => {
  it('現在を末尾へ回し次へ進む', () => {
    let q = buildTriageQueue([note('a', 1), note('b', 2), note('c', 3)]);
    q = advanceSkip(q);
    expect(q.order).toEqual(['b', 'c', 'a']);
    expect(currentNoteId(q)).toBe('b');
    expect(remainingCount(q)).toBe(3); // done にはならない
    expect(doneCount(q)).toBe(0);
  });
  it('スキップしてもいずれ一周して戻る', () => {
    let q = buildTriageQueue([note('a', 1), note('b', 2)]);
    q = advanceSkip(q); // a を後回し → b
    expect(currentNoteId(q)).toBe('b');
    q = advanceSkip(q); // b を後回し → a
    expect(currentNoteId(q)).toBe('a');
  });
  it('1 件しか残っていなければ留まる', () => {
    let q = buildTriageQueue([note('a', 1)]);
    q = advanceSkip(q);
    expect(currentNoteId(q)).toBe('a');
    expect(q.order).toEqual(['a']);
  });
  it('skip した付箋を後で処理できる', () => {
    let q = buildTriageQueue([note('a', 1), note('b', 2)]);
    q = advanceSkip(q); // → b が現在
    q = advanceProcessed(q); // b を done → 次は a
    expect(q.done.has('b')).toBe(true);
    expect(currentNoteId(q)).toBe('a');
    expect(remainingCount(q)).toBe(1);
  });
});

describe('混在シナリオ', () => {
  it('昇格・スキップ・破棄を織り交ぜても整合', () => {
    let q = buildTriageQueue([note('a', 1), note('b', 2), note('c', 3), note('d', 4)]);
    q = advanceProcessed(q); // a done → b
    expect(currentNoteId(q)).toBe('b');
    q = advanceSkip(q); // b 後回し → c
    expect(currentNoteId(q)).toBe('c');
    q = advanceProcessed(q); // c done → d
    expect(currentNoteId(q)).toBe('d');
    q = advanceProcessed(q); // d done → b(後回し分)
    expect(currentNoteId(q)).toBe('b');
    expect(remainingCount(q)).toBe(1);
    q = advanceProcessed(q); // b done → 完了
    expect(isComplete(q)).toBe(true);
  });
});
