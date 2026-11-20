import { describe, expect, test } from 'bun:test';
import {
  type Celebration,
  firstName,
  lineOf,
  wellDoneOf,
} from '@robis/web/features/feed/celebrations-model.ts';

/** What a celebration says (Phase 2c), and the well done it starts: no pronouns, the name. */

const base = {
  id: 'x',
  at: '2026-11-20T09:00:00.000Z',
  userId: '00000000-0000-4000-8000-000000000001',
  projectId: null,
  projectName: null,
} as const;
const of = (fields: Pick<Celebration, 'kind' | 'count'> & Partial<Celebration>): Celebration => ({
  ...base,
  ...fields,
});

describe('a celebration', () => {
  test('each kind, as the card says it and as the well done starts', () => {
    const name = 'Mia Rossi';
    expect(lineOf(of({ kind: 'issues_done', count: 25 }), name)).toBe(
      'Mia Rossi has finished 25 issues here',
    );
    expect(wellDoneOf(of({ kind: 'issues_done', count: 25 }), name)).toBe(
      'Well done, Mia, on 25 issues finished!',
    );
    expect(lineOf(of({ kind: 'anniversary', count: 1 }), name)).toBe(
      'Mia Rossi has been with the team for a year',
    );
    expect(wellDoneOf(of({ kind: 'anniversary', count: 3 }), name)).toBe(
      'Happy anniversary, Mia: 3 years with the team!',
    );
    expect(lineOf(of({ kind: 'joined', count: null }), name)).toBe(
      'Mia Rossi joined the team this week',
    );
    expect(wellDoneOf(of({ kind: 'joined', count: null }), name)).toBe('Welcome to the team, Mia!');
    const finished = of({
      kind: 'project_finished',
      count: 12,
      userId: null,
      projectName: 'Launch',
    });
    expect(lineOf(finished, 'Someone')).toBe('Launch is done: every issue closed');
    expect(wellDoneOf(finished, 'Someone')).toBe('Launch is done. Well done, everyone!');
  });

  test('a first name is the first word, or the whole name', () => {
    expect(firstName('  Alex  Kim ')).toBe('Alex');
    expect(firstName('Robis')).toBe('Robis');
  });
});
