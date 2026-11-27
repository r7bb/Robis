import { describe, expect, test } from 'bun:test';
import type { SaphaTurn } from '@robis/shared';
import {
  aboutDraft,
  changesOf,
  hasQuestion,
  isSaphaShortcut,
  lastAsked,
  linkIssues,
  retryOf,
  sourcesOf,
  startersAbout,
  stillAnswering,
} from '@robis/web/features/sapha/panel/turn-model.ts';

/**
 * Sapha's panel, the parts with no browser: which keys in an answer become
 * links, which proposals become cards, the shortcut, and whether an answer
 * is still on its way.
 */

const rel4 = { id: 'i4', key: 'REL-4', title: 'Fix login' };
const none = {
  issueKey: null,
  status: null,
  priority: null,
  person: null,
  title: null,
  board: null,
  when: null,
  query: null,
  place: null,
};

describe('an answer’s links', () => {
  test('only issues Sapha looked at become links, whatever case they are written in', () => {
    expect(linkIssues('REL-4 waits on rel-9, and so does rel-4.', [rel4])).toEqual([
      { issue: rel4, text: 'REL-4' },
      { text: ' waits on rel-9, and so does ' },
      { issue: rel4, text: 'rel-4' },
      { text: '.' },
    ]);
  });

  test('plain words stay plain, and a key inside a longer word is not one', () => {
    expect(linkIssues('No issues here.', [rel4])).toEqual([{ text: 'No issues here.' }]);
    expect(linkIssues('XREL-4 and REL-45', [rel4])).toEqual([{ text: 'XREL-4 and REL-45' }]);
  });
});

describe('proposals as cards', () => {
  test('each change that still reads, checked on this clock; others left out', () => {
    const now = new Date(2026, 10, 25, 10);
    const changes = changesOf(
      [
        { ...none, kind: 'status', issueKey: 'REL-4', status: 'DONE' },
        { ...none, kind: 'due', issueKey: 'REL-4', when: 'friday' },
        { ...none, kind: 'status', issueKey: 'not a key', status: 'DONE' },
        { ...none, kind: 'search', query: 'login' },
      ],
      now,
    );
    expect(changes).toEqual([
      { kind: 'status', issueKey: 'REL-4', status: 'DONE' },
      { kind: 'due', issueKey: 'REL-4', dueOn: '2026-11-27' },
    ]);
  });
});

describe('the panel', () => {
  test('opens with Ctrl J or Cmd J, and nothing else', () => {
    expect(
      isSaphaShortcut({ key: 'j', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      isSaphaShortcut({ key: 'J', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }),
    ).toBe(true);
    expect(
      isSaphaShortcut({ key: 'j', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true }),
    ).toBe(false);
    expect(
      isSaphaShortcut({ key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe(false);
  });

  test('still answering while the last turn waits', () => {
    const turn = (status: SaphaTurn['status']): SaphaTurn => ({
      id: status,
      role: 'sapha',
      text: '',
      status,
      steps: [],
      proposals: [],
      issues: [],
      createdAt: '2026-11-25T10:00:00.000Z',
    });
    expect(stillAnswering([])).toBe(false);
    expect(stillAnswering([turn('done'), turn('pending')])).toBe(true);
    expect(stillAnswering([turn('pending'), turn('failed')])).toBe(false);
  });

  test('opened from an issue, the draft names it and the starters ask about it', () => {
    expect(aboutDraft('ENG-12')).toBe('About ENG-12: ');
    expect(aboutDraft(null)).toBe('');
    const about = startersAbout('ENG-12');
    expect(about.length).toBeGreaterThan(1);
    for (const starter of about) expect(starter).toContain('ENG-12');
    expect(startersAbout(null)).not.toContain(about[0]);
    expect(startersAbout(null).length).toBeGreaterThan(0);
  });

  test('the issue’s name alone is not a question, and is not sent', () => {
    expect(hasQuestion('About ENG-12: ', 'ENG-12')).toBe(false);
    expect(hasQuestion('  ', null)).toBe(false);
    expect(hasQuestion('About ENG-12: who has it?', 'ENG-12')).toBe(true);
    expect(hasQuestion('What keeps slipping?', null)).toBe(true);
  });

  test('a failed answer, the latest, can be asked again in the same words', () => {
    const turn = (
      role: SaphaTurn['role'],
      status: SaphaTurn['status'],
      text: string,
    ): SaphaTurn => ({
      id: `${role}-${text}`,
      role,
      text,
      status,
      steps: [],
      proposals: [],
      issues: [],
      createdAt: '2026-11-27T10:00:00.000Z',
    });
    const asked = turn('person', 'done', 'What keeps slipping?');
    expect(retryOf([asked, turn('sapha', 'failed', 'Could not answer')])).toBe(
      'What keeps slipping?',
    );
    expect(retryOf([asked, turn('sapha', 'done', 'Two issues')])).toBeNull();
    expect(retryOf([asked, turn('sapha', 'pending', '')])).toBeNull();
    expect(retryOf([])).toBeNull();
    // An earlier failure, answered since, is not offered again.
    expect(
      retryOf([
        asked,
        turn('sapha', 'failed', 'x'),
        turn('person', 'done', 'Again'),
        turn('sapha', 'done', 'ok'),
      ]),
    ).toBeNull();
  });

  test('up in an empty composer brings back the last question asked', () => {
    const turn = (role: SaphaTurn['role'], text: string): SaphaTurn => ({
      id: `${role}-${text}`,
      role,
      text,
      status: 'done',
      steps: [],
      proposals: [],
      issues: [],
      createdAt: '2026-11-27T10:00:00.000Z',
    });
    expect(
      lastAsked([
        turn('person', 'First'),
        turn('sapha', 'A'),
        turn('person', 'Second'),
        turn('sapha', 'B'),
      ]),
    ).toBe('Second');
    expect(lastAsked([])).toBeNull();
  });

  test('the sources under an answer: each issue looked at once, a few, and how many more', () => {
    const cited = (n: number) => ({ id: `i${n}`, key: `WEB-${n}`, title: `Issue ${n}` });
    expect(sourcesOf([cited(1), cited(2), cited(1)])).toEqual({
      shown: [cited(1), cited(2)],
      more: 0,
    });
    const many = sourcesOf(Array.from({ length: 9 }, (_, n) => cited(n + 1)));
    expect(many.shown.map((issue) => issue.key)).toEqual([
      'WEB-1',
      'WEB-2',
      'WEB-3',
      'WEB-4',
      'WEB-5',
      'WEB-6',
    ]);
    expect(many.more).toBe(3);
    expect(sourcesOf([])).toEqual({ shown: [], more: 0 });
  });
});
