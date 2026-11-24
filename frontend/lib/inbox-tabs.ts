/**
 * The inbox in two (idea 4): Priority, what asks something of you (you were
 * named, given an issue, invited, or a meeting you are in changed), and
 * Other, what is good to know (comments on your issues, suggestions). Any
 * kind not named here is Other, so a new kind never jumps the queue. Later
 * holds what was snoozed, until its time comes.
 */

export const INBOX_TABS = ['priority', 'other', 'later'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const INBOX_TAB_NAMES: Record<InboxTab, string> = {
  priority: 'Priority',
  other: 'Other',
  later: 'Later',
};

const PRIORITY_KINDS: ReadonlySet<string> = new Set([
  'mention',
  'assignment',
  'invitation',
  'meeting',
  // You asked to be reminded, so it asks something of you.
  'reminder',
]);

export function inboxTabOf(kind: string): InboxTab {
  return PRIORITY_KINDS.has(kind) ? 'priority' : 'other';
}

/** Whether a snoozed entry is still waiting at `now`. */
export function isWaiting(snoozedUntil: string | null | undefined, now: number): boolean {
  return Boolean(snoozedUntil) && new Date(snoozedUntil!).getTime() > now;
}

/**
 * The inbox split by tab, order kept, with each tab's unread count. What
 * waits under Later is soonest first and counts as nothing unread yet.
 */
export function splitInbox<
  T extends { kind: string; readAt: unknown; snoozedUntil?: string | null },
>(items: readonly T[], now: number = Date.now()): Record<InboxTab, { items: T[]; unread: number }> {
  const split: Record<InboxTab, { items: T[]; unread: number }> = {
    priority: { items: [], unread: 0 },
    other: { items: [], unread: 0 },
    later: { items: [], unread: 0 },
  };
  for (const item of items) {
    if (isWaiting(item.snoozedUntil, now)) {
      split.later.items.push(item);
      continue;
    }
    const tab = split[inboxTabOf(item.kind)];
    tab.items.push(item);
    if (!item.readAt) tab.unread++;
  }
  split.later.items.sort(
    (a, b) => new Date(a.snoozedUntil!).getTime() - new Date(b.snoozedUntil!).getTime(),
  );
  return split;
}
