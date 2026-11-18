import { describe, expect, test } from 'bun:test';
import { ROLES } from '@robis/shared';
import {
  allowedCommands,
  arrangeCommands,
  type Command,
  GROUP_CAP,
  isPaletteShortcut,
  matchScore,
  rankCommands,
} from '@robis/web/lib/commands.ts';
import { ACTIONS, type Action, may } from '@robis/web/lib/permissions.ts';

/** The command palette (C2): what it offers, in what order, and to whom. */

const command = (id: string, title: string, extra: Partial<Command> = {}): Command => ({
  id,
  title,
  group: 'Actions',
  ...extra,
});

describe('matching what was typed', () => {
  test('an empty query matches anything', () => {
    expect(matchScore('Go to board', '')).toBeGreaterThan(0);
    expect(matchScore('Go to board', '   ')).toBeGreaterThan(0);
  });

  test('every word typed must appear', () => {
    expect(matchScore('Change status to Done', 'status done')).toBeGreaterThan(0);
    expect(matchScore('Change status to Done', 'status todo')).toBe(0);
  });

  test('the start of the title beats the start of a word beats the middle of one', () => {
    const start = matchScore('Board for release', 'boa');
    const word = matchScore('Release board', 'boa');
    const middle = matchScore('Keyboard shortcuts', 'boa');
    expect(start).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(0);
  });

  test('ignores case and accents', () => {
    expect(matchScore('Zoë Hartmann', 'zoe')).toBeGreaterThan(0);
    expect(matchScore('zoe hartmann', 'ZOË')).toBeGreaterThan(0);
  });

  test('keywords count, but less than the title', () => {
    const viaKeyword = matchScore('Release board', 'go', ['go to']);
    expect(viaKeyword).toBeGreaterThan(0);
    expect(matchScore('Go somewhere', 'go')).toBeGreaterThan(viaKeyword);
  });
});

describe('ranking the list', () => {
  const status = command('status', 'Change status…', {
    flatten: true,
    children: [
      command('status:todo', 'Change status to Todo'),
      command('status:done', 'Change status to Done'),
    ],
  });
  const person = command('person:zoe', 'Zoë Hartmann', {
    group: 'People',
    children: [command('person:zoe:release', 'Zoë’s issues on the Release board')],
  });

  test('with nothing typed, the list is as given and children stay inside', () => {
    const list = [status, person];
    expect(rankCommands(list, '').map((c) => c.id)).toEqual(['status', 'person:zoe']);
  });

  test('a child a parent lets out is found on its own', () => {
    expect(rankCommands([status, person], 'done').map((c) => c.id)).toEqual(['status:done']);
  });

  test('a matching parent stands for its children', () => {
    expect(rankCommands([status], 'change status').map((c) => c.id)).toEqual(['status']);
  });

  test('a child its parent keeps inside is not listed', () => {
    expect(rankCommands([person], 'release')).toEqual([]);
  });

  test('best match first, ties in the order given', () => {
    const list = [
      command('a', 'Keyboard shortcuts'),
      command('b', 'Board settings'),
      command('c', 'Board filters'),
    ];
    expect(rankCommands(list, 'board').map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('laying the list out', () => {
  const list: Command[] = [
    command('zoe', 'Zoë', { group: 'People' }),
    command('rel', 'Release board', { group: 'Boards' }),
    command('new', 'New issue', { group: 'Actions' }),
    ...Array.from({ length: GROUP_CAP + 2 }, (_, n) =>
      command(`b${n}`, `Board ${n}`, { group: 'Boards' }),
    ),
  ];

  test('groups in a fixed order, each capped, order inside kept', () => {
    const sections = arrangeCommands(list, { browsing: false });
    expect(sections.map((s) => s.group)).toEqual(['Actions', 'Boards', 'People']);
    expect(sections[1]?.commands).toHaveLength(GROUP_CAP);
    expect(sections[1]?.commands[0]?.id).toBe('rel');
  });

  test('before anything is typed, only actions and boards', () => {
    expect(arrangeCommands(list, { browsing: true }).map((s) => s.group)).toEqual([
      'Actions',
      'Boards',
    ]);
  });
});

describe('who sees which command', () => {
  test('a command needing an action the role may not take is hidden', () => {
    const list = [command('new', 'New issue', { action: 'newIssue' }), command('go', 'Go')];
    expect(allowedCommands(list, 'GUEST').map((c) => c.id)).toEqual(['go']);
    expect(allowedCommands(list, 'MEMBER').map((c) => c.id)).toEqual(['new', 'go']);
  });

  test('before the role is known, only commands that need nothing show', () => {
    const list = [command('new', 'New issue', { action: 'newIssue' }), command('go', 'Go')];
    expect(allowedCommands(list, undefined).map((c) => c.id)).toEqual(['go']);
  });

  test('children are checked too, and a parent left with none is dropped', () => {
    const parent = command('p', 'Change status…', {
      children: [command('c', 'Change status to Done', { action: 'editIssue' })],
    });
    expect(allowedCommands([parent], 'GUEST')).toEqual([]);
    expect(allowedCommands([parent], 'MEMBER')[0]?.children?.map((c) => c.id)).toEqual(['c']);
  });

  test('a command is shown exactly when its button is', () => {
    for (const role of ROLES) {
      for (const action of Object.keys(ACTIONS) as Action[]) {
        const shown = allowedCommands([command('x', 'X', { action })], role).length === 1;
        expect(shown, `${role} ${action}`).toBe(may(role, action));
      }
    }
  });
});

describe('opening the palette', () => {
  const key = (init: Partial<KeyboardEventInit> & { key: string }) => ({
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
  });

  test('Ctrl K and Cmd K, whatever the case', () => {
    expect(isPaletteShortcut(key({ key: 'k', ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ key: 'k', metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ key: 'K', metaKey: true }))).toBe(true);
  });

  test('not a plain K, and not with Alt or Shift', () => {
    expect(isPaletteShortcut(key({ key: 'k' }))).toBe(false);
    expect(isPaletteShortcut(key({ key: 'k', ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteShortcut(key({ key: 'k', metaKey: true, shiftKey: true }))).toBe(false);
  });
});
