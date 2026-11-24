import { describe, expect, test } from 'bun:test';
import { findBoard, findPerson } from '@robis/web/features/sapha/resolve.ts';

/** Who and where Sapha takes a request to mean: one match, or a question back. */

const people = [
  { userId: 'u1', name: 'Ana Lee', kind: 'human' as const },
  { userId: 'u2', name: 'Ana Ruiz', kind: 'human' as const },
  { userId: 'u3', name: 'Zoë Park', kind: 'human' as const },
  { userId: 'a1', name: 'Scout', kind: 'agent' as const },
];
const boards = [
  { id: 'b1', key: 'WEB', name: 'Web', archived: false },
  { id: 'b2', key: 'OPS', name: 'Operations', archived: false },
  { id: 'b3', key: 'OLD', name: 'Old site', archived: true },
];

describe('finding a person', () => {
  test('by full name, by a first name only one has, and as me', () => {
    expect(findPerson(people, 'ana lee', null)).toMatchObject({
      ok: true,
      value: { userId: 'u1' },
    });
    expect(findPerson(people, 'zoe', null)).toMatchObject({ ok: true, value: { userId: 'u3' } });
    expect(findPerson(people, 'me', 'u2')).toMatchObject({ ok: true, value: { userId: 'u2' } });
  });

  test('two of a name, nobody, or an agent: a question back', () => {
    expect(findPerson(people, 'Ana', null)).toEqual({
      ok: false,
      reason: 'More than one Ana here: Ana Lee, Ana Ruiz. Say the full name.',
    });
    expect(findPerson(people, 'Bo', null)).toMatchObject({ ok: false });
    // An agent is never given an issue (it is a delegate at most).
    expect(findPerson(people, 'Scout', null)).toMatchObject({ ok: false });
  });
});

describe('finding a board', () => {
  test('by name, key or the start of a name; the only open one when none is named', () => {
    expect(findBoard(boards, 'web')).toMatchObject({ ok: true, value: { id: 'b1' } });
    expect(findBoard(boards, 'OPS')).toMatchObject({ ok: true, value: { id: 'b2' } });
    expect(findBoard(boards, 'oper')).toMatchObject({ ok: true, value: { id: 'b2' } });
    expect(findBoard([boards[0]!, boards[2]!], null)).toMatchObject({
      ok: true,
      value: { id: 'b1' },
    });
  });

  test('several open with none named, an archived one, or none: a question back', () => {
    expect(findBoard(boards, null)).toMatchObject({ ok: false });
    expect(findBoard(boards, 'Old site')).toMatchObject({ ok: false });
    expect(findBoard([], null)).toEqual({ ok: false, reason: 'There is no board here yet.' });
  });
});
