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
    threadId?: string;
    replyId?: string;
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
    case 'space_reply':
      return {
        actor,
        did: 'replied in',
        subject: payload.title ?? 'a thread',
        body: payload.excerpt,
      };
    case 'space_answer':
      return {
        actor,
        did: 'marked your reply as the answer to',
        subject: payload.title ?? 'a question',
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

/** Where an entry about an issue, a meeting or a thread leads. */
export function notificationHref(item: Item): string {
  const { payload, workspaceId } = item;
  if (payload.issueId && workspaceId) {
    return `/workspaces/${workspaceId}/issues/${payload.issueId}`;
  }
  if (payload.threadId && workspaceId) {
    const reply = payload.replyId ? `#reply-${payload.replyId}` : '';
    return `/workspaces/${workspaceId}/spaces/threads/${payload.threadId}${reply}`;
  }
  return item.workspaceId ? `/workspaces/${item.workspaceId}` : '/workspaces';
}
