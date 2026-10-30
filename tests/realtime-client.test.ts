import { describe, expect, test } from 'bun:test';
import type { ServerEvent } from '@robis/shared';
import {
  COALESCE_MS,
  coalescer,
  concernsBoard,
  concernsIssue,
  staleKeys,
} from '@robis/web/lib/realtime-events.ts';

/**
 * What the web app does with a realtime event (stage 3, item 23): which
 * cached queries it makes stale, and whether an open board or issue page
 * needs to pull at all. A chat message is not a reason to sync a board.
 */

const W = 'w1';
const ids = { workspaceId: W, actorId: 'a1' };
const issueCreated: ServerEvent = { type: 'issue.created', projectId: 'p1', issueId: 'i1', ...ids };
const issueUpdated: ServerEvent = { type: 'issue.updated', projectId: 'p1', issueId: 'i1', ...ids };
const chat: ServerEvent = { type: 'message.created', channelId: 'c1', messageId: 'm1', ...ids };

/** A timer you advance by hand. */
function manualTimers() {
  let due: (() => void) | null = null;
  let scheduled = 0;
  return {
    timers: {
      set: (run: () => void, _ms: number) => {
        due = run;
        scheduled += 1;
        return scheduled;
      },
      clear: () => {
        due = null;
      },
    },
    fire: () => {
      const run = due;
      due = null;
      run?.();
    },
    scheduled: () => scheduled,
  };
}

describe('which events a page acts on', () => {
  test('a chat message causes no board sync, and no issue refresh', () => {
    expect(concernsBoard(chat, 'p1')).toBe(false);
    expect(concernsIssue(chat, 'i1')).toBe(false);
  });

  test("a board pulls for its own project's issues only", () => {
    expect(concernsBoard(issueCreated, 'p1')).toBe(true);
    expect(concernsBoard(issueUpdated, 'p1')).toBe(true);
    expect(concernsBoard({ ...issueUpdated, projectId: 'p2' }, 'p1')).toBe(false);
    expect(concernsBoard({ type: 'comment.created', issueId: 'i1', ...ids }, 'p1')).toBe(false);
  });

  test('an issue page refreshes for that issue, its comments and its images only', () => {
    expect(concernsIssue(issueUpdated, 'i1')).toBe(true);
    expect(concernsIssue({ type: 'comment.created', issueId: 'i1', ...ids }, 'i1')).toBe(true);
    expect(concernsIssue({ type: 'comment.created', issueId: 'i2', ...ids }, 'i1')).toBe(false);
    expect(concernsIssue({ ...issueUpdated, issueId: 'i2' }, 'i1')).toBe(false);
  });
});

describe('what an event makes stale', () => {
  test('a new issue refreshes its project’s issues and the project list', () => {
    expect(staleKeys(issueCreated)).toEqual([
      ['issues', W, 'p1'],
      ['projects', W],
    ]);
  });

  test('a chat message refreshes only that channel', () => {
    expect(staleKeys(chat)).toEqual([['messages', W, 'c1']]);
  });
});

describe('coalescing', () => {
  test('everything within the window flushes once, together', () => {
    const clock = manualTimers();
    const flushed: number[][] = [];
    const batch = coalescer<number>((items) => flushed.push(items), COALESCE_MS, clock.timers);

    batch.push(1);
    batch.push(2);
    batch.push(3);
    expect(flushed).toEqual([]);
    expect(clock.scheduled()).toBe(1);

    clock.fire();
    expect(flushed).toEqual([[1, 2, 3]]);

    batch.push(4);
    clock.fire();
    expect(flushed).toEqual([[1, 2, 3], [4]]);
  });

  test('the window is 150 ms', () => {
    expect(COALESCE_MS).toBe(150);
  });

  test('a cancelled batch never flushes', () => {
    const clock = manualTimers();
    const flushed: number[][] = [];
    const batch = coalescer<number>((items) => flushed.push(items), COALESCE_MS, clock.timers);
    batch.push(1);
    batch.cancel();
    clock.fire();
    expect(flushed).toEqual([]);
  });
});
