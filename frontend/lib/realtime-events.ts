import type { ServerEvent } from '@robis/shared';

/**
 * What the web app does with a realtime event (stage 3, item 23), apart from
 * the socket: which cached queries it makes stale, and whether an open board
 * or issue page needs to pull. Pure, so it is tested without a browser.
 */

/** Invalidations and pulls that land this close together are done once. */
export const COALESCE_MS = 150;

/** The query keys an event makes stale. */
export function staleKeys(event: ServerEvent): unknown[][] {
  switch (event.type) {
    case 'attachment.changed':
      return [['attachments', event.workspaceId, event.issueId]];
    case 'issue.created':
    case 'issue.updated':
    case 'issue.deleted':
      // Open-issue counts on the project list move too.
      return [
        ['issues', event.workspaceId, event.projectId],
        ['projects', event.workspaceId],
      ];
    case 'project.created':
    case 'project.deleted':
      return [['projects', event.workspaceId]];
    case 'comment.created':
      return [['comments', event.workspaceId, event.issueId]];
    case 'member.changed':
      return [
        ['members', event.workspaceId],
        ['invitations', event.workspaceId],
        ['workspace', event.workspaceId],
      ];
    /*
     * Chat invalidates rather than appending the pushed row: the event
     * carries ids only, so the message is re-read through the authorised
     * endpoint. It costs a round trip per burst and keeps one place where
     * access is decided.
     */
    case 'message.created':
    case 'message.deleted':
      return [['messages', event.workspaceId, event.channelId]];
    case 'channel.created':
    case 'channel.deleted':
      return [['channels', event.workspaceId]];
    case 'meeting.changed':
      return [['meetings', event.workspaceId]];
    case 'document.created':
      return [['documents', event.workspaceId]];
  }
}

/** Whether an open board for `projectId` should pull for this event. */
export function concernsBoard(event: ServerEvent, projectId: string): boolean {
  return (
    (event.type === 'issue.created' ||
      event.type === 'issue.updated' ||
      event.type === 'issue.deleted') &&
    event.projectId === projectId
  );
}

/** Whether an open issue page should refresh for this event. */
export function concernsIssue(event: ServerEvent, issueId: string): boolean {
  switch (event.type) {
    case 'issue.updated':
    case 'issue.deleted':
    case 'comment.created':
    case 'attachment.changed':
      return event.issueId === issueId;
    default:
      return false;
  }
}

export type Timers = {
  set: (run: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Collect what arrives within `windowMs` of the first item and hand it to
 * `flush` once, together. A burst of events (an import, a teammate moving
 * five cards) becomes one refetch per key rather than one per event.
 */
export function coalescer<T>(
  flush: (items: T[]) => void,
  windowMs = COALESCE_MS,
  timers: Timers = realTimers,
) {
  let pending: T[] = [];
  let timer: unknown;
  let scheduled = false;
  return {
    push(item: T) {
      pending.push(item);
      if (scheduled) return;
      scheduled = true;
      timer = timers.set(() => {
        const items = pending;
        pending = [];
        scheduled = false;
        flush(items);
      }, windowMs);
    },
    /** Drop what is waiting; for a page being left. */
    cancel() {
      if (scheduled) timers.clear(timer);
      pending = [];
      scheduled = false;
    },
  };
}

/** Each key once, however many events named it. */
export function uniqueKeys(keys: readonly unknown[][]): unknown[][] {
  const seen = new Map<string, unknown[]>();
  for (const key of keys) seen.set(JSON.stringify(key), key);
  return [...seen.values()];
}
