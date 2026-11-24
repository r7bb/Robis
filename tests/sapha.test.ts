import { describe, expect, test } from 'bun:test';
import { describeIntent, intentFromParts, interpret } from '@robis/shared';

/**
 * Sapha, tier 0: plain requests read into one of a few intents, with no
 * model and no network. What it cannot read it leaves alone (null), so the
 * palette goes on searching; what changes anything is only ever proposed.
 */

// Tuesday 24 November 2026, 10:15 local time.
const NOW = new Date(2026, 10, 24, 10, 15);
const read = (text: string) => interpret(text, NOW);

describe('reading a request', () => {
  test('changing an issue: status, priority, assignee, due day', () => {
    expect(read('move REL-4 to done')).toEqual({
      kind: 'status',
      issueKey: 'REL-4',
      status: 'DONE',
    });
    expect(read('mark rel-12 as in progress')).toEqual({
      kind: 'status',
      issueKey: 'REL-12',
      status: 'IN_PROGRESS',
    });
    expect(read('REL-4 is in review')).toMatchObject({ status: 'IN_REVIEW' });
    expect(read('cancel REL-9')).toEqual({ kind: 'status', issueKey: 'REL-9', status: 'CANCELED' });
    expect(read('make REL-4 urgent')).toEqual({
      kind: 'priority',
      issueKey: 'REL-4',
      priority: 'URGENT',
    });
    expect(read('set REL-4 priority to low')).toMatchObject({ priority: 'LOW' });
    expect(read('assign REL-4 to Ana Lee')).toEqual({
      kind: 'assign',
      issueKey: 'REL-4',
      person: 'Ana Lee',
    });
    expect(read('give REL-4 to me')).toEqual({ kind: 'assign', issueKey: 'REL-4', person: 'me' });
    expect(read('unassign REL-4')).toEqual({ kind: 'unassign', issueKey: 'REL-4' });
    expect(read('REL-4 due friday')).toEqual({
      kind: 'due',
      issueKey: 'REL-4',
      dueOn: '2026-11-27',
    });
    expect(read('REL-4 due tomorrow')).toMatchObject({ dueOn: '2026-11-25' });
    expect(read('clear the due date on REL-4')).toEqual({
      kind: 'due',
      issueKey: 'REL-4',
      dueOn: null,
    });
  });

  test('making things: an issue, a reminder, a meeting', () => {
    expect(read('new issue Fix the login loop')).toEqual({
      kind: 'create',
      title: 'Fix the login loop',
      board: null,
    });
    expect(read('create an issue "Tidy settings" on Web')).toEqual({
      kind: 'create',
      title: 'Tidy settings',
      board: 'Web',
    });
    expect(read('remind me about REL-12 tomorrow 9am')).toEqual({
      kind: 'remind',
      issueKey: 'REL-12',
      at: new Date(2026, 10, 25, 9),
    });
    expect(read('remind me of REL-12 in 2 hours')).toMatchObject({
      at: new Date(NOW.getTime() + 2 * 3_600_000),
    });
    expect(read('schedule Retro friday 3pm')).toEqual({
      kind: 'schedule',
      title: 'Retro',
      at: new Date(2026, 10, 27, 15),
    });
    expect(read('book a meeting called Planning on monday at 10')).toEqual({
      kind: 'schedule',
      title: 'Planning',
      at: new Date(2026, 10, 30, 10),
    });
  });

  test('finding and going: open, search, places', () => {
    expect(read('open REL-4')).toEqual({ kind: 'open', issueKey: 'REL-4' });
    expect(read('REL-4')).toEqual({ kind: 'open', issueKey: 'REL-4' });
    expect(read('find the release checklist')).toEqual({
      kind: 'search',
      query: 'the release checklist',
    });
    expect(read('search for vpn')).toEqual({ kind: 'search', query: 'vpn' });
    expect(read("what's due today")).toEqual({ kind: 'go', place: 'day' });
    expect(read('my day')).toEqual({ kind: 'go', place: 'day' });
    expect(read('show my calendar')).toEqual({ kind: 'go', place: 'calendar' });
    expect(read("who's here")).toEqual({ kind: 'go', place: 'feed' });
    expect(read('go to spaces')).toEqual({ kind: 'go', place: 'spaces' });
  });

  test('a greeting, a polite word and her name change nothing', () => {
    expect(read('Sapha, move REL-4 to done please')).toEqual(read('move REL-4 to done'));
    expect(read('hey sapha can you open REL-4')).toEqual({ kind: 'open', issueKey: 'REL-4' });
  });

  test('what is not understood is left to search', () => {
    for (const text of [
      '',
      'board',
      'release',
      'move it to done',
      'remind me tomorrow',
      'schedule',
    ]) {
      expect(read(text)).toBeNull();
    }
    // A time it cannot read is not guessed.
    expect(read('remind me about REL-4 whenever')).toBeNull();
    expect(read('REL-4 due someday')).toBeNull();
  });
});

describe('saying what it will do', () => {
  test('in a sentence a person can check before confirming', () => {
    const at = (text: string) => describeIntent(read(text)!, NOW);
    expect(at('move REL-4 to done')).toBe('Move REL-4 to Done');
    expect(at('make REL-4 urgent')).toBe('Make REL-4 Urgent priority');
    expect(at('assign REL-4 to Ana')).toBe('Give REL-4 to Ana');
    expect(at('unassign REL-4')).toBe('Unassign REL-4');
    expect(at('REL-4 due friday')).toBe('Make REL-4 due Fri 27 Nov');
    expect(at('clear the due date on REL-4')).toBe('Clear the due date on REL-4');
    expect(at('new issue Fix the login loop')).toBe('Create the issue “Fix the login loop”');
    expect(at('remind me about REL-12 tomorrow 9am')).toBe(
      'Remind you about REL-12, Wed 25 Nov 09:00',
    );
    expect(at('schedule Retro friday 3pm')).toBe('Schedule “Retro”, Fri 27 Nov 15:00');
    expect(at('open REL-4')).toBe('Open REL-4');
    expect(at('find vpn')).toBe('Search for “vpn”');
    expect(at('my day')).toBe('Show your day');
  });

  test('which intents change something, and so need a yes', () => {
    const changes = ['move REL-4 to done', 'new issue X', 'remind me about REL-4 tomorrow'];
    const looks = ['open REL-4', 'find vpn', 'my day'];
    for (const text of changes) expect(read(text)?.kind).toMatch(/status|create|remind/);
    for (const text of looks) expect(read(text)?.kind).toMatch(/open|search|go/);
  });
});

describe('tier 1: parts from the provider', () => {
  const none = {
    kind: 'none' as const,
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

  test('read into the same intents, the time from its words on this clock', () => {
    expect(
      intentFromParts({ ...none, kind: 'status', issueKey: 'rel-4', status: 'DONE' }, NOW),
    ).toEqual({ kind: 'status', issueKey: 'REL-4', status: 'DONE' });
    expect(
      intentFromParts({ ...none, kind: 'remind', issueKey: 'REL-12', when: 'tomorrow 9am' }, NOW),
    ).toEqual({ kind: 'remind', issueKey: 'REL-12', at: new Date(2026, 10, 25, 9) });
    expect(
      intentFromParts(
        { ...none, kind: 'schedule', title: '  Planning  ', when: 'friday 3pm' },
        NOW,
      ),
    ).toEqual({ kind: 'schedule', title: 'Planning', at: new Date(2026, 10, 27, 15) });
    expect(intentFromParts({ ...none, kind: 'go', place: 'calendar' }, NOW)).toEqual({
      kind: 'go',
      place: 'calendar',
    });
  });

  test('parts that do not hold are nothing: no key, no time, none at all', () => {
    expect(
      intentFromParts({ ...none, kind: 'status', issueKey: 'not a key', status: 'DONE' }, NOW),
    ).toBeNull();
    expect(intentFromParts({ ...none, kind: 'status', issueKey: 'REL-4' }, NOW)).toBeNull();
    expect(
      intentFromParts({ ...none, kind: 'remind', issueKey: 'REL-4', when: 'someday' }, NOW),
    ).toBeNull();
    expect(intentFromParts({ ...none, kind: 'create', title: '   ' }, NOW)).toBeNull();
    expect(intentFromParts(none, NOW)).toBeNull();
  });
});
