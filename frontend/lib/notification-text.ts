/**
 * What an inbox entry says about something done to you (C3): who did it,
 * what they did, and to what. Invitations and nudges speak for themselves
 * and are worded where they are shown.
 */

type Item = {
  kind: string;
  workspaceId: string | null;
  actorName: string | null;
  payload: {
    issueId?: string;
    issueKey?: string | null;
    issueTitle?: string | null;
    excerpt?: string;
    title?: string;
    change?: 'moved' | 'changed' | 'canceled';
  };
};

const MEETING_DID: Record<NonNullable<Item['payload']['change']>, string> = {
  moved: 'moved',
  changed: 'changed',
  canceled: 'called off',
};

export function describeNotification(item: Item): {
  actor: string;
  did: string;
  subject: string | null;
  body: string | undefined;
} {
  const actor = item.actorName ?? 'Someone';
  const { payload } = item;
  switch (item.kind) {
    case 'assignment':
      return {
        actor,
        did: 'gave you',
        subject: payload.issueKey ?? null,
        body: payload.issueTitle ?? undefined,
      };
    case 'issue_comment':
      return {
        actor,
        did: 'commented on',
        subject: payload.issueKey ?? null,
        body: payload.excerpt,
      };
    case 'meeting':
      return {
        actor,
        did: MEETING_DID[payload.change ?? 'changed'],
        subject: payload.title ?? 'a meeting',
        body: undefined,
      };
    default:
      return {
        actor,
        did: 'mentioned you',
        subject: payload.issueKey ?? null,
        body: payload.excerpt,
      };
  }
}

/** Where an entry about an issue or a meeting leads. */
export function notificationHref(item: Item): string {
  if (item.payload.issueId && item.workspaceId) {
    return `/workspaces/${item.workspaceId}/issues/${item.payload.issueId}`;
  }
  return item.workspaceId ? `/workspaces/${item.workspaceId}` : '/workspaces';
}
