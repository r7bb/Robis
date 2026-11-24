import { describe, expect, test } from 'bun:test';
import { NOTIFICATION_KINDS } from '@robis/shared';
import { inboxTabOf, splitInbox } from '@robis/web/lib/inbox-tabs.ts';

describe('the inbox in two', () => {
  test('what asks something of you is Priority', () => {
    for (const kind of ['mention', 'assignment', 'invitation', 'meeting']) {
      expect(inboxTabOf(kind)).toBe('priority');
    }
  });

  test('what is good to know is Other, and so is a kind not yet named', () => {
    expect(inboxTabOf('issue_comment')).toBe('other');
    expect(inboxTabOf('nudge')).toBe('other');
    expect(inboxTabOf('something_new')).toBe('other');
  });

  test('every kind a setting exists for lands in a tab', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(['priority', 'other']).toContain(inboxTabOf(kind));
    }
  });

  test('splits in order and counts what is unread in each', () => {
    const items = [
      { id: 1, kind: 'issue_comment', readAt: null },
      { id: 2, kind: 'mention', readAt: null },
      { id: 3, kind: 'nudge', readAt: '2026-11-19T00:00:00Z' },
      { id: 4, kind: 'assignment', readAt: '2026-11-19T00:00:00Z' },
      { id: 5, kind: 'meeting', readAt: null },
    ];
    const split = splitInbox(items);
    expect(split.priority.items.map((i) => i.id)).toEqual([2, 4, 5]);
    expect(split.priority.unread).toBe(2);
    expect(split.other.items.map((i) => i.id)).toEqual([1, 3]);
    expect(split.other.unread).toBe(1);
  });

  test('what is snoozed waits under Later, soonest first, and counts as nothing yet', () => {
    const now = Date.parse('2026-11-24T10:00:00Z');
    const items = [
      { id: 1, kind: 'mention', readAt: null, snoozedUntil: '2026-11-27T09:00:00Z' },
      { id: 2, kind: 'issue_comment', readAt: null, snoozedUntil: '2026-11-25T09:00:00Z' },
      // Its time has come: back where it belongs, unread.
      { id: 3, kind: 'mention', readAt: null, snoozedUntil: '2026-11-24T09:00:00Z' },
      { id: 4, kind: 'nudge', readAt: null, snoozedUntil: null },
    ];
    const split = splitInbox(items, now);
    expect(split.later.items.map((i) => i.id)).toEqual([2, 1]);
    expect(split.later.unread).toBe(0);
    expect(split.priority.items.map((i) => i.id)).toEqual([3]);
    expect(split.priority.unread).toBe(1);
    expect(split.other.items.map((i) => i.id)).toEqual([4]);
  });
});
