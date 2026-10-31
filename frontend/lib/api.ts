import {
  type CallInput,
  type Contract,
  type contracts,
  pathFor,
  type ResponseOf,
} from '@robis/shared';

import { API_URL } from './endpoints.ts';

export const BASE_URL = API_URL;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Every call sends the session cookie. The API is on a different port, so
 * without `credentials: 'include'` the browser would omit it and every request
 * would look unauthenticated.
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error ?? 'unknown',
      payload?.message ?? `Request failed with ${response.status}`,
    );
  }

  return payload as T;
}

/** A call's input, plus any headers it needs (an idempotency key, say). */
type CallOptions<C extends Contract> = CallInput<C> & { headers?: Record<string, string> };

type CallArgs<C extends Contract> =
  Record<string, never> extends CallInput<C> ? [input?: CallOptions<C>] : [input: CallOptions<C>];

/**
 * Call a route through its contract (stage 2, item 20): the path, method and
 * body come from the same description the API serves it from, and so does
 * the type of what comes back.
 */
export function call<C extends Contract>(
  route: C,
  ...[input]: CallArgs<C>
): Promise<ResponseOf<C>> {
  const { params, query, body, headers } = (input ?? {}) as {
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
  };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const suffix = search.size > 0 ? `?${search}` : '';
  return api<ResponseOf<C>>(`${pathFor(route.path, params)}${suffix}`, {
    method: route.method,
    body,
    headers,
  });
}

/** Your own account, as the contract describes it. */
export type Me = ResponseOf<(typeof contracts)['auth.me']>;

/** A workspace in your list, as the API's contract describes it. */
export type WorkspaceSummary = ResponseOf<
  (typeof contracts)['workspaces.list']
>['workspaces'][number];

/** Someone in a workspace, as the contract describes them. */
export type Member = ResponseOf<(typeof contracts)['members.list']>['members'][number];

/** An invitation waiting for you to answer. */
export type MyInvitation = ResponseOf<
  (typeof contracts)['invitations.mine']
>['invitations'][number];

/**
 * An invitation a workspace has sent: to a person (username set) or to an
 * address (email set, as it was typed; never shown as who it turned out to be).
 */
export type SentInvitation = ResponseOf<
  (typeof contracts)['invitations.sent']
>['invitations'][number];

/** Who an invitation is for, as the people who sent it may see it. */
export function invitedLabel(invitation: SentInvitation): string {
  return invitation.username ? `@${invitation.username}` : (invitation.email ?? 'someone');
}

/** One comment, as the contract describes it. */
type Comment = ResponseOf<(typeof contracts)['comments.list']>['comments'][number];

export type CommentMention = Comment['mentions'][number];

/** One notification, as the contract describes it. */
export type NotificationItem = ResponseOf<
  (typeof contracts)['notifications.list']
>['notifications'][number];

/** One search result, as the contract describes it. */
export type SearchHit = ResponseOf<(typeof contracts)['search.workspace']>['results'][number];

/** One audit event, in the shape the export API and the SIEM stream share. */
export type AuditEvent = AuditPage['events'][number];

type AuditPage = ResponseOf<(typeof contracts)['audit.events']>;

/** What `/audit/verify` found. `broken` names the first bad link, if any. */
export type ChainReport = ResponseOf<(typeof contracts)['audit.verify']>;
