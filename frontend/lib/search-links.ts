import { SEARCH_KINDS } from '@robis/shared';

/**
 * Where search results lead, and the results page's own address (C1), kept
 * in one place for the search box and the results page.
 */

type Kind = (typeof SEARCH_KINDS)[number];

type Hit = { kind: Kind; id: string; issueId: string | null };

/** A result's page. A comment's own id is not addressable, so it opens its issue. */
export function hitHref(workspaceId: string, hit: Hit): string {
  if (hit.kind === 'document') return `/workspaces/${workspaceId}/documents/${hit.id}`;
  if (hit.issueId) return `/workspaces/${workspaceId}/issues/${hit.issueId}`;
  return `/workspaces/${workspaceId}`;
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
