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
