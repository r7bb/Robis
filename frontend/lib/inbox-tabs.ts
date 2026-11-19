/**
 * The inbox in two (idea 4): Priority, what asks something of you (you were
 * named, given an issue, invited, or a meeting you are in changed), and
 * Other, what is good to know (comments on your issues, suggestions). Any
 * kind not named here is Other, so a new kind never jumps the queue.
 */

export const INBOX_TABS = ['priority', 'other'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

export const INBOX_TAB_NAMES: Record<InboxTab, string> = {
  priority: 'Priority',
  other: 'Other',
};

const PRIORITY_KINDS: ReadonlySet<string> = new Set([
  'mention',
  'assignment',
  'invitation',
  'meeting',
]);

export function inboxTabOf(kind: string): InboxTab {
  return PRIORITY_KINDS.has(kind) ? 'priority' : 'other';
}

/** The inbox split by tab, order kept, with each tab's unread count. */
export function splitInbox<T extends { kind: string; readAt: unknown }>(
  items: readonly T[],
): Record<InboxTab, { items: T[]; unread: number }> {
  const split: Record<InboxTab, { items: T[]; unread: number }> = {
    priority: { items: [], unread: 0 },
    other: { items: [], unread: 0 },
  };
  for (const item of items) {
    const tab = split[inboxTabOf(item.kind)];
    tab.items.push(item);
    if (!item.readAt) tab.unread++;
  }
  return split;
}
