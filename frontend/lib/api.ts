import {
  type Avatar as AvatarRef,
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

export type Me = {
  user: {
    id: string;
    email: string;
    name: string;
    /** The app-specific `@handle`. */
    username: string;
    /** Null until a picture is chosen; the welcome step asks for one. */
    avatar: AvatarRef;
    /**
     * Whether the current terms are agreed to. When `needed`, the app asks
     * before anything else and the server refuses workspace use.
     */
    consent: { needed: boolean; termsVersion: string | null; current: string };
    /** False for an account whose username was given to it; asked once. */
    usernameConfirmed: boolean;
    /** Whether the address has been confirmed. Joining a workspace needs it. */
    emailVerified: boolean;
    emailVerifiedAt: string | null;
  };
};

/** A workspace in your list, as the API's contract describes it. */
export type WorkspaceSummary = ResponseOf<
  (typeof contracts)['workspaces.list']
>['workspaces'][number];

/** A project in a workspace's list, as the contract describes it. */
export type ProjectSummary = ResponseOf<(typeof contracts)['projects.list']>['projects'][number];

/** Someone in a workspace, as the contract describes them. */
export type Member = ResponseOf<(typeof contracts)['members.list']>['members'][number];

/** An invitation waiting for you to answer. */
export type MyInvitation = ResponseOf<
  (typeof contracts)['invitations.mine']
>['invitations'][number];

/** An invitation a workspace has sent, as its admins see it. */
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

export type DocumentSummary = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
};

/** One issue, as the contract describes it. */
export type IssueDetail = ResponseOf<(typeof contracts)['issues.get']>['issue'];

/** One comment, as the contract describes it. */
export type Comment = ResponseOf<(typeof contracts)['comments.list']>['comments'][number];

export type CommentMention = Comment['mentions'][number];

export type NotificationItem = {
  id: string;
  kind: string;
  entityType: string;
  entityId: string;
  payload: {
    /** Mentions. */
    issueId?: string;
    issueKey?: string | null;
    issueTitle?: string | null;
    excerpt?: string;
    /** Invitations. */
    workspaceName?: string | null;
    role?: string;
    /** Nudges. */
    title?: string;
    body?: string;
    nudge?: string;
  };
  workspaceId: string | null;
  readAt: string | null;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
};

export type SearchHit = {
  kind: 'issue' | 'document' | 'comment';
  id: string;
  title: string;
  /** Excerpt with matched terms wrapped in `<mark>`; rendered as text, not HTML. */
  snippet: string;
  rank: number;
  issueId: string | null;
  projectId: string | null;
};

/**
 * One entry in the workspace audit trail.
 *
 * `payload` is deliberately loose: each event type stores the fields that
 * describe it, recorded as they were at the time, and the renderer switches on
 * `eventType`. Typing it as a discriminated union would be neater, but the
 * trail is append-only and holds rows written by older code, so the renderer
 * has to tolerate payloads it does not recognise either way.
 */
/** One entry of a workspace's activity feed, as the contract describes it. */
export type ActivityEvent = ResponseOf<(typeof contracts)['workspaces.activity']>['events'][number];

/** One audit event, in the shape the export API and the SIEM stream share. */
export type AuditEvent = {
  key: string;
  workspaceId: string;
  seq: number;
  occurredAt: string;
  actor: { id: string | null; kind: 'human' | 'agent' | 'system' };
  actorName: string | null;
  requestId: string | null;
  entity: { type: string; id: string };
  type: string;
  payload: Record<string, unknown>;
  prevHash: string | null;
  hash: string;
  /** The key that signed it; null for an event from before signing. */
  keyId: string | null;
  /** Personal fields kept outside the hash; null once erased. */
  personal: Record<string, unknown> | null;
  personalCommitment: string | null;
};

export type AuditPage = { events: AuditEvent[]; nextCursor: number | null };

/** What `/audit/verify` found. `broken` names the first bad link, if any. */
/** Someone who appears in a workspace's audit trail, member or not. */
export type AuditActorSummary = {
  id: string;
  username: string | null;
  name: string | null;
  /** No longer a member: still listed, because their events still are. */
  former: boolean;
};

export type ChainReport = {
  ok: boolean;
  /** Events walked: all of them, or those after `fromSeq`. */
  checked: number;
  /** 0 for a full walk, or the checkpoint this check started from. */
  fromSeq: number;
  /** Whether a stored checkpoint was used, or rejected as not genuine. */
  checkpoint: 'none' | 'used' | 'rejected' | 'stale';
  head: { seq: number; hash: string } | null;
  broken: {
    seq: number;
    eventId: string | null;
    reason:
      | 'missing'
      | 'altered'
      | 'relinked'
      | 'truncated'
      | 'downgraded'
      | 'unverifiable'
      | 'unsigned';
    detail: string;
  } | null;
};

/** One active browser session. Token hashes never reach the client. */
export type SessionSummary = {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  current: boolean;
};
