import type { Avatar as AvatarRef, IssuePriority, IssueStatus, Role, ThemeId } from '@robis/shared';

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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

export type Me = {
  user: {
    id: string;
    email: string;
    name: string;
    /** The app-specific `@handle`. */
    username: string;
    /** Null until a picture is chosen; the welcome step asks for one. */
    avatar: AvatarRef;
    /** Whether the address has been confirmed. Nothing is gated on it yet. */
    emailVerified: boolean;
    emailVerifiedAt: string | null;
  };
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  role: Role;
  theme: ThemeId;
};

export type ProjectSummary = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  archived: boolean;
  openIssues: number;
};

export type Member = {
  userId: string;
  /** Only admins and owners are sent addresses; everyone else gets null. */
  email: string | null;
  name: string;
  username: string;
  role: Role;
  avatar: AvatarRef;
};

export type DocumentSummary = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
};

export type IssueDetail = {
  id: string;
  key: string;
  number: number;
  projectId: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  /** Who each `@handle` meant when it was written, with today's username. */
  mentions: CommentMention[];
};

export type CommentMention = { handle: string; userId: string; username: string };

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
export type ActivityEvent = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  payload: Record<string, string | undefined>;
  createdAt: string;
};

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
