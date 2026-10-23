import type { PresenceUser, ServerEvent } from '@robis/shared';

/**
 * The signed-in home's plain logic, kept apart from React so it can be
 * tested on its own (`tests/home.test.ts`).
 */

/** One line of the live feed. */
export type FeedItem = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  text: string;
  href: string;
  /** When it arrived, as epoch milliseconds. */
  at: number;
};

/** What each kind of event says, after the actor's name. */
const VERBS: Partial<Record<ServerEvent['type'], string>> = {
  'issue.created': 'opened an issue',
  'issue.updated': 'updated an issue',
  'issue.deleted': 'removed an issue',
  'comment.created': 'commented on an issue',
  'project.created': 'started a project',
  'project.deleted': 'removed a project',
  'document.created': 'started a document',
  'member.changed': 'changed who is on the team',
  'meeting.changed': 'changed a meeting',
};

/**
 * The feed line for an event, or null for one the home does not show:
 * messages (a channel can be private, and the overview leaves them out for
 * the same reason) and changes too small to be news, like attachments.
 */
export function describeEvent(event: ServerEvent, actorName: string | null): string | null {
  const verb = VERBS[event.type];
  if (!verb) return null;
  return `${actorName ?? 'A teammate'} ${verb}`;
}

let sequence = 0;

/** A feed line for an event, linked to where it happened. */
export function feedItemFrom(
  event: ServerEvent,
  context: { actorName: string | null; workspaceName: string; at: number },
): FeedItem | null {
  const text = describeEvent(event, context.actorName);
  if (!text) return null;
  const issueId = 'issueId' in event ? event.issueId : null;
  return {
    id: `${context.at}-${++sequence}`,
    workspaceId: event.workspaceId,
    workspaceName: context.workspaceName,
    text,
    href: issueId
      ? `/workspaces/${event.workspaceId}/issues/${issueId}`
      : `/workspaces/${event.workspaceId}`,
    at: context.at,
  };
}

/**
 * Everyone else connected right now, once each, across every workspace's
 * presence list. Presence comes from live sockets only, so nobody is shown
 * as here after they have gone.
 */
export function othersHere(
  myId: string,
  lists: readonly (readonly PresenceUser[])[],
): PresenceUser[] {
  const byId = new Map<string, PresenceUser>();
  for (const list of lists) {
    for (const user of list) {
      if (user.userId !== myId && !byId.has(user.userId)) byId.set(user.userId, user);
    }
  }
  return [...byId.values()];
}

/** Morning until noon, afternoon until six, evening otherwise. */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The latest live event, for the hero: `seq` goes up by one each time. */
export type SparkSignal = { workspaceId: string; actorId: string; seq: number };
