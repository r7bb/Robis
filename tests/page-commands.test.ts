import { describe, expect, test } from 'bun:test';
import type { IssueStatus } from '@robis/shared';
import { allowedCommands, rankCommands } from '@robis/web/lib/commands.ts';
import { boardCommands, issueCommands } from '@robis/web/lib/page-commands.ts';

/** What the board and the issue page add to the palette (C2). */

const label = (status: IssueStatus) => status.toLowerCase();

describe("the open issue's status", () => {
  test('offers every other status, and sets the one chosen', () => {
    const set: IssueStatus[] = [];
    const [parent] = issueCommands({
      issueKey: 'REL-2',
      status: 'TODO',
      statusLabel: label,
      setStatus: (s) => set.push(s),
    });
    expect(parent?.children?.map((c) => c.title)).toEqual([
      'Change status to in_progress',
      'Change status to in_review',
      'Change status to done',
    ]);
    parent?.children?.[2]?.run?.();
    expect(set).toEqual(['DONE']);
  });

  test('typing the status finds it straight away', () => {
    const commands = issueCommands({
      issueKey: 'REL-2',
      status: 'TODO',
      statusLabel: label,
      setStatus: () => undefined,
    });
    expect(rankCommands(commands, 'done').map((c) => c.id)).toEqual(['issue-status:DONE']);
  });

  test('a guest is offered none of it, as the status field is closed to them', () => {
    const commands = issueCommands({
      issueKey: 'REL-2',
      status: 'TODO',
      statusLabel: label,
      setStatus: () => undefined,
    });
    expect(allowedCommands(commands, 'GUEST')).toEqual([]);
    expect(allowedCommands(commands, 'MEMBER')).toHaveLength(1);
  });
});

describe('the board', () => {
  const base = {
    projectName: 'Release',
    compose: () => undefined,
    selecting: false,
    toggleSelecting: () => undefined,
    filtered: false,
    clearFilters: () => undefined,
    showShortcuts: () => undefined,
  };

  test('new issue here and select issues, for those who may; the shortcuts for all', () => {
    expect(allowedCommands(boardCommands(base), 'MEMBER').map((c) => c.title)).toEqual([
      'New issue in Release',
      'Select issues',
      'Keyboard shortcuts',
    ]);
    expect(allowedCommands(boardCommands(base), 'GUEST').map((c) => c.title)).toEqual([
      'Keyboard shortcuts',
    ]);
  });

  test('clearing filters only when there are some, for anyone', () => {
    const commands = boardCommands({ ...base, filtered: true, selecting: true });
    expect(allowedCommands(commands, 'GUEST').map((c) => c.title)).toEqual([
      'Keyboard shortcuts',
      'Clear filters',
    ]);
    expect(commands.map((c) => c.title)).toContain('Stop selecting issues');
  });
});
