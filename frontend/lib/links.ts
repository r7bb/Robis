import type { BoardFilter } from '@robis/shared';
import { filterToQuery } from './board-filter.ts';

/**
 * Addresses the command palette (C2) sends people to, beside the pages that
 * read them, so the two cannot disagree on a parameter's name.
 */

/** On a board: open it with the new issue field focused. */
export const COMPOSE_PARAM = 'new';
/** On the workspace page: the channel to open. */
export const CHANNEL_PARAM = 'channel';
/** On a board: the issue open in the peek over it. */
export const PEEK_PARAM = 'issue';

/** This address with one parameter set, or taken out when `value` is null; the rest kept. */
export function withParam(
  pathname: string,
  search: string,
  name: string,
  value: string | null,
): string {
  const params = new URLSearchParams(search);
  if (value === null) params.delete(name);
  else params.set(name, value);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** A project's board, filtered or not, and ready to file an issue or not. */
export function boardHref(
  workspaceId: string,
  projectId: string,
  { filter = {}, compose = false }: { filter?: BoardFilter; compose?: boolean } = {},
): string {
  const params = new URLSearchParams(filterToQuery(filter));
  if (compose) params.set(COMPOSE_PARAM, '1');
  const query = params.toString();
  return `/workspaces/${workspaceId}/projects/${projectId}${query ? `?${query}` : ''}`;
}

/** The workspace page with one channel open. */
export function channelHref(workspaceId: string, channelId: string): string {
  return `/workspaces/${workspaceId}?${CHANNEL_PARAM}=${encodeURIComponent(channelId)}`;
}

/** A member's profile in this workspace (B2). */
export function personHref(workspaceId: string, userId: string): string {
  return `/workspaces/${workspaceId}/people/${userId}`;
}

/** An issue's own page. */
export function issueHref(workspaceId: string, issueId: string): string {
  return `/workspaces/${workspaceId}/issues/${issueId}`;
}

export function spacesHref(workspaceId: string): string {
  return `/workspaces/${workspaceId}/spaces`;
}

export function spaceHref(workspaceId: string, spaceId: string): string {
  return `/workspaces/${workspaceId}/spaces/${spaceId}`;
}

export function threadHref(workspaceId: string, threadId: string): string {
  return `/workspaces/${workspaceId}/spaces/threads/${threadId}`;
}
