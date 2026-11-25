import { describe, expect, test } from 'bun:test';
import { describeIntent, intentFromParts, interpret, LOOKING_INTENTS } from '@robis/shared';

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
    expect(read("what's blocking REL-4?")).toEqual({ kind: 'blockers', issueKey: 'REL-4' });
    expect(read('what is REL-4 waiting on')).toEqual({ kind: 'blockers', issueKey: 'REL-4' });
    expect(read('rel-4 blocked by')).toEqual({ kind: 'blockers', issueKey: 'REL-4' });
    for (const asked of [
      'who has REL-4?',
      "who's working on REL-4",
      'status of rel-4',
      "how's REL-4 going",
      'tell me about REL-4',
    ]) {
      expect(read(asked)).toEqual({ kind: 'about', issueKey: 'REL-4' });
    }
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
    expect(at('what is blocking REL-4')).toBe('What REL-4 waits on');
    expect(at('who has REL-4')).toBe('How REL-4 stands');
  });

  test('which intents change something, and so need a yes', () => {
    const changes = ['move REL-4 to done', 'new issue X', 'remind me about REL-4 tomorrow'];
    const looks = ['open REL-4', 'find vpn', 'my day'];
    for (const text of changes) expect(read(text)?.kind).toMatch(/status|create|remind/);
    for (const text of looks) expect(read(text)?.kind).toMatch(/open|search|go/);
  });
});

describe('putting an issue in a cycle or a release', () => {
  test('the current cycle, the next release, or one by name, as typed', () => {
    expect(read('put REL-4 in the current cycle')).toEqual({
      kind: 'plan',
      issueKey: 'REL-4',
      into: 'cycle',
      name: null,
    });
    expect(read('add rel-4 to the sprint')).toEqual({
      kind: 'plan',
      issueKey: 'REL-4',
      into: 'cycle',
      name: null,
    });
    expect(read('add WEB-3 to the next release')).toEqual({
      kind: 'plan',
      issueKey: 'WEB-3',
      into: 'release',
      name: null,
    });
    expect(read('move WEB-3 to the release Version 2.0')).toEqual({
      kind: 'plan',
      issueKey: 'WEB-3',
      into: 'release',
      name: 'Version 2.0',
    });
    expect(read('put REL-4 in cycle Relaunch, part one')).toEqual({
      kind: 'plan',
      issueKey: 'REL-4',
      into: 'cycle',
      name: 'Relaunch, part one',
    });
  });

  test('taken out again, and said back; a status still reads as a status', () => {
    expect(read('take REL-4 out of the release')).toEqual({
      kind: 'unplan',
      issueKey: 'REL-4',
      from: 'release',
    });
    expect(read('remove REL-4 from the cycle')).toEqual({
      kind: 'unplan',
      issueKey: 'REL-4',
      from: 'cycle',
    });
    const at = (text: string) => describeIntent(read(text)!, NOW);
    expect(at('put REL-4 in the current cycle')).toBe('Put REL-4 in the current cycle');
    expect(at('add WEB-3 to the next release')).toBe('Put WEB-3 in the next release');
    expect(at('move WEB-3 to the release Version 2.0')).toBe('Put WEB-3 in Version 2.0');
    expect(at('take REL-4 out of the release')).toBe('Take REL-4 out of its release');
    expect(read('move REL-4 to done')).toMatchObject({ kind: 'status', status: 'DONE' });
    expect(LOOKING_INTENTS.has('plan')).toBe(false);
  });
});

describe('planning a cycle or a release', () => {
  test('a cycle of so many days or weeks, on a board when named', () => {
    expect(read('plan a two week cycle on Web')).toEqual({
      kind: 'newCycle',
      days: 14,
      board: 'Web',
    });
    expect(read('start a 10-day sprint')).toEqual({ kind: 'newCycle', days: 10, board: null });
    expect(read('plan a cycle')).toEqual({ kind: 'newCycle', days: 14, board: null });
  });

  test('a release by name, and its day in words on this clock', () => {
    expect(read('plan a release Version 3 for friday')).toEqual({
      kind: 'newRelease',
      name: 'Version 3',
      targetOn: '2026-11-27',
    });
    expect(read('plan a release called Relaunch 2')).toEqual({
      kind: 'newRelease',
      name: 'Relaunch 2',
      targetOn: null,
    });
  });

  test('said back, and changes that wait for a yes', () => {
    const at = (text: string) => describeIntent(read(text)!, NOW);
    expect(at('plan a two week cycle on Web')).toBe(
      'Plan a 14-day cycle on Web, from today or after the cycles already planned',
    );
    expect(at('plan a cycle')).toBe(
      'Plan a 14-day cycle, from today or after the cycles already planned',
    );
    expect(at('plan a release Version 3 for friday')).toBe(
      'Plan the release “Version 3”, aimed at Fri 27 Nov',
    );
    expect(at('plan a release called Relaunch 2')).toBe('Plan the release “Relaunch 2”');
    expect(LOOKING_INTENTS.has('newCycle')).toBe(false);
  });
});

describe('what the planning and template readers leave alone', () => {
  test('words about release notes or candidates, a template called “the”, a 0-day or 9-week cycle', () => {
    for (const text of [
      'add WEB-3 to release notes',
      'plan release notes',
      'create release candidate',
      'use the template for x',
      'plan a 0-day cycle',
      'plan a 57-day cycle',
      'plan a 9-week cycle',
    ]) {
      const kind = read(text)?.kind;
      expect(['plan', 'newRelease', 'template', 'newCycle']).not.toContain(kind);
    }
  });

  test('a release name with for in it, a question mark kept, and polite words', () => {
    expect(read('plan a release Launch for customers')).toEqual({
      kind: 'newRelease',
      name: 'Launch for customers',
      targetOn: null,
    });
    expect(read('new issue why is login slow?')).toMatchObject({ title: 'why is login slow?' });
    for (const text of [
      'please use the bug report template for Login loops',
      'okay sapha, use the bug report template for Login loops',
    ]) {
      expect(read(text)).toEqual({
        kind: 'template',
        template: 'bug report',
        title: 'Login loops',
        board: null,
      });
    }
  });
});

describe('filing from a template', () => {
  test('by the template’s name, with a title, and a board when the title is quoted', () => {
    expect(read('use the bug report template for Login loops on Safari')).toEqual({
      kind: 'template',
      template: 'bug report',
      title: 'Login loops on Safari',
      board: null,
    });
    expect(read('from the Bug report template: Crash on save')).toEqual({
      kind: 'template',
      template: 'Bug report',
      title: 'Crash on save',
      board: null,
    });
    expect(read('use the bug report template for "Crash on save" on Web')).toEqual({
      kind: 'template',
      template: 'bug report',
      title: 'Crash on save',
      board: 'Web',
    });
    expect(read('use the weekly check template')).toEqual({
      kind: 'template',
      template: 'weekly check',
      title: null,
      board: null,
    });
  });

  test('said back, and a change that waits for a yes', () => {
    expect(describeIntent(read('use the bug report template for Login loops')!, NOW)).toBe(
      'File “Login loops” from the bug report template',
    );
    expect(describeIntent(read('use the weekly check template')!, NOW)).toBe(
      'File from the weekly check template',
    );
    expect(LOOKING_INTENTS.has('template')).toBe(false);
  });

  test('from the provider’s parts, the template’s name its own part', () => {
    const parts = {
      kind: 'template' as const,
      issueKey: null,
      status: null,
      priority: null,
      person: null,
      title: 'Crash on save',
      board: null,
      when: null,
      query: null,
      place: null,
      template: ' Bug report ',
    };
    expect(intentFromParts(parts, NOW)).toEqual({
      kind: 'template',
      template: 'Bug report',
      title: 'Crash on save',
      board: null,
    });
    expect(intentFromParts({ ...parts, template: null }, NOW)).toBeNull();
  });
});

describe('asking how a release is going', () => {
  test('the next release, or one by name, as typed', () => {
    for (const text of [
      'how is the release going?',
      "how's the next release",
      'what is left in the release',
      'release progress',
    ]) {
      expect(read(text)).toEqual({ kind: 'release', name: null });
    }
    expect(read('how is release Relaunch 1.0 going')).toEqual({
      kind: 'release',
      name: 'Relaunch 1.0',
    });
    expect(read("what's left for the release Version 2")).toEqual({
      kind: 'release',
      name: 'Version 2',
    });
    expect(read('release status for Relaunch 1.0')).toEqual({
      kind: 'release',
      name: 'Relaunch 1.0',
    });
  });

  test('said back plainly; release notes and a bare word are not it', () => {
    expect(describeIntent(read('how is the release going')!, NOW)).toBe(
      'How the next release is going',
    );
    expect(describeIntent(read('release progress for Relaunch 1.0')!, NOW)).toBe(
      'How Relaunch 1.0 is going',
    );
    expect(read('release')).toBeNull();
    expect(read('find release notes')).toEqual({ kind: 'search', query: 'release notes' });
  });

  test('a name only in a question’s own shape; ordinary words stay searches', () => {
    for (const text of [
      'how is release planning done',
      'release status of the api',
      'release candidate checklist',
    ]) {
      expect(read(text)?.kind).not.toBe('release');
    }
  });

  test('from the provider’s parts, the name as its title', () => {
    const parts = {
      kind: 'release' as const,
      issueKey: null,
      status: null,
      priority: null,
      person: null,
      title: '  Relaunch 1.0 ',
      board: null,
      when: null,
      query: null,
      place: null,
    };
    expect(intentFromParts(parts, NOW)).toEqual({ kind: 'release', name: 'Relaunch 1.0' });
    expect(intentFromParts({ ...parts, title: null }, NOW)).toEqual({
      kind: 'release',
      name: null,
    });
  });
});

describe('asking how the cycle is going', () => {
  test('in the ways people ask, on one board when named, as typed', () => {
    for (const text of [
      'how is the cycle going?',
      "how's the sprint",
      'what is left in the cycle',
      'cycle progress',
      'Sapha, how is our current cycle doing',
    ]) {
      expect(read(text)).toEqual({ kind: 'cycle', board: null });
    }
    expect(read('how is the cycle going on Web Relaunch')).toEqual({
      kind: 'cycle',
      board: 'Web Relaunch',
    });
    expect(read("what's left in the sprint for the App board")).toEqual({
      kind: 'cycle',
      board: 'App',
    });
  });

  test('for me or us is every board, not a board called me', () => {
    expect(read('how is the cycle going for me')).toEqual({ kind: 'cycle', board: null });
    expect(read('what is left in the sprint for us')).toEqual({ kind: 'cycle', board: null });
  });

  test('said back plainly; a bare word is still a search', () => {
    expect(describeIntent(read('how is the cycle going')!, NOW)).toBe('How the cycles are going');
    expect(describeIntent(read('cycle status on Web')!, NOW)).toBe('How the cycle on Web is going');
    expect(read('cycle')).toBeNull();
    expect(read('find cycle time')).toEqual({ kind: 'search', query: 'cycle time' });
  });

  test('from the provider’s parts too, the board bounded', () => {
    const parts = {
      kind: 'cycle' as const,
      issueKey: null,
      status: null,
      priority: null,
      person: null,
      title: null,
      board: '  Web  ',
      when: null,
      query: null,
      place: null,
    };
    expect(intentFromParts(parts, NOW)).toEqual({ kind: 'cycle', board: 'Web' });
    expect(intentFromParts({ ...parts, board: null }, NOW)).toEqual({ kind: 'cycle', board: null });
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

  test('into a cycle or release and out again, by its name when one is said', () => {
    expect(
      intentFromParts(
        { ...none, kind: 'plan', issueKey: 'web-3', into: 'release', title: ' Version 2.0 ' },
        NOW,
      ),
    ).toEqual({ kind: 'plan', issueKey: 'WEB-3', into: 'release', name: 'Version 2.0' });
    expect(
      intentFromParts({ ...none, kind: 'plan', issueKey: 'REL-4', into: 'cycle' }, NOW),
    ).toEqual({ kind: 'plan', issueKey: 'REL-4', into: 'cycle', name: null });
    expect(
      intentFromParts({ ...none, kind: 'unplan', issueKey: 'REL-4', into: 'release' }, NOW),
    ).toEqual({ kind: 'unplan', issueKey: 'REL-4', from: 'release' });
  });

  test('planning without saying where, or without a key, is nothing', () => {
    expect(intentFromParts({ ...none, kind: 'plan', issueKey: 'REL-4' }, NOW)).toBeNull();
    expect(intentFromParts({ ...none, kind: 'unplan', issueKey: 'REL-4' }, NOW)).toBeNull();
    expect(intentFromParts({ ...none, kind: 'plan', into: 'cycle' }, NOW)).toBeNull();
  });

  test('a new cycle runs the days said, two weeks when none are, on the board named', () => {
    expect(intentFromParts({ ...none, kind: 'newCycle', days: 10, board: 'Web' }, NOW)).toEqual({
      kind: 'newCycle',
      days: 10,
      board: 'Web',
    });
    expect(intentFromParts({ ...none, kind: 'newCycle' }, NOW)).toEqual({
      kind: 'newCycle',
      days: 14,
      board: null,
    });
  });

  test('a cycle of no days, part days or past eight weeks is nothing', () => {
    for (const days of [0, -3, 2.5, 57]) {
      expect(intentFromParts({ ...none, kind: 'newCycle', days }, NOW)).toBeNull();
    }
  });

  test('a new release by its name, aimed at the day said on this clock', () => {
    expect(
      intentFromParts({ ...none, kind: 'newRelease', title: 'Version 3', when: 'friday' }, NOW),
    ).toEqual({ kind: 'newRelease', name: 'Version 3', targetOn: '2026-11-27' });
    expect(intentFromParts({ ...none, kind: 'newRelease', title: 'Version 3' }, NOW)).toEqual({
      kind: 'newRelease',
      name: 'Version 3',
      targetOn: null,
    });
  });

  test('a release with no name, or a day that does not read as one, is nothing', () => {
    expect(intentFromParts({ ...none, kind: 'newRelease', when: 'friday' }, NOW)).toBeNull();
    expect(
      intentFromParts({ ...none, kind: 'newRelease', title: 'Version 3', when: 'someday' }, NOW),
    ).toBeNull();
  });
});
