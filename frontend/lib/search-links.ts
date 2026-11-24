import { SEARCH_KINDS } from '@robis/shared';
import { channelHref, threadHref } from './links.ts';

/**
 * Where search results lead, and the results page's own address (C1), kept
 * in one place for the search box and the results page.
 */

type Kind = (typeof SEARCH_KINDS)[number];

type Hit = {
  kind: Kind;
  id: string;
  issueId: string | null;
  channelId?: string | null;
  threadId?: string | null;
};

/**
 * A result's page. A comment's own id is not addressable, so it opens its
 * issue; a message opens its room at the message, a reply its thread at the
 * reply, and a meeting the meetings page at the meeting.
 */
export function hitHref(workspaceId: string, hit: Hit): string {
  const base = `/workspaces/${workspaceId}`;
  switch (hit.kind) {
    case 'document':
      return `${base}/documents/${hit.id}`;
    case 'message':
      return hit.channelId ? `${channelHref(workspaceId, hit.channelId)}#message-${hit.id}` : base;
    case 'thread':
      return `${threadHref(workspaceId, hit.id)}`;
    case 'reply':
      return hit.threadId ? `${threadHref(workspaceId, hit.threadId)}#reply-${hit.id}` : base;
    case 'meeting':
      return `${base}/meetings#meeting-${hit.id}`;
    default:
      return hit.issueId ? `${base}/issues/${hit.issueId}` : base;
  }
}

/** The results page for a query, narrowed to one kind or not. */
export function searchHref(workspaceId: string, q: string, type?: Kind | null): string {
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (type) params.set('type', type);
  const query = params.toString();
  return `/workspaces/${workspaceId}/search${query ? `?${query}` : ''}`;
}

/** The kind named in the address, or none when it is missing or not a kind. */
export function kindFromParam(raw: string | null): Kind | null {
  return SEARCH_KINDS.find((kind) => kind === raw) ?? null;
}
