import { describe, expect, test } from 'bun:test';
import type { SaphaTurn } from '@robis/shared';
import {
  aboutDraft,
  changesOf,
  hasQuestion,
  isSaphaShortcut,
  linkIssues,
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
});
