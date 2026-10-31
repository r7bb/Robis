import { type AuthenticatedUser, resolveSession, resolveSessionIn } from '@robis/auth';
import { type AuditActor, type Database, findMembership } from '@robis/database';
import { can, type Permission, type Role } from '@robis/shared';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ApiError } from '../errors.ts';

declare module 'fastify' {
  interface FastifyInstance {
    /** `robis_session`, or `__Host-robis_session` in production. */
    sessionCookieName: string;
  }
  interface FastifyRequest {
    user?: AuthenticatedUser;
    /**
     * Set by `attachUser` on a workspace route: the role (null for none) that
     * came with the session, so `requireMembership` need not ask again.
     */
    resolvedRole?: { workspaceId: string; role: Role | null };
    /** Set by `requireMembership`; the actor's role in the workspace on the path. */
    membership?: { workspaceId: string; role: Role };
  }
}

export function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) throw ApiError.unauthorized();
  return request.user;
}

export function currentMembership(request: FastifyRequest) {
  if (!request.membership) throw new Error('requireMembership did not run for this route');
  return request.membership;
}

/**
 * A picture comes before anything else in Robis.
 *
 * Enforced here as well as in the app, so calling the API directly cannot
 * skip it. Applied to every workspace route through `requireMembership` and
 * to creating a workspace; account routes stay open so the picture can be
 * chosen in the first place.
 */
function assertHasAvatar(user: AuthenticatedUser) {
  if (!user.hasAvatar) {
    throw new ApiError(403, 'avatar_required', 'Add a picture before you start');
  }
}

/**
 * The current terms come before workspaces too.
 *
 * When `TERMS_VERSION` changes, or for an account from before agreement was
 * stored, workspace routes answer 403 `terms_required` until the person
 * agrees again. Account routes stay open, so the question can be answered,
 * and so do the invitations list and other people's avatars, which show
 * no workspace content. The realtime gateway checks on subscribe; a new
 * terms version ships with a deploy, which restarts the gateway, so every
 * open socket subscribes again and is checked.
 */
export function assertHasAgreed(user: AuthenticatedUser) {
  if (!user.hasAgreed) {
    throw new ApiError(403, 'terms_required', 'Agree to the current terms before you continue');
  }
}

/** Everything a person settles before using a workspace, in the order asked. */
export function assertReady(user: AuthenticatedUser) {
  assertHasAgreed(user);
  assertHasAvatar(user);
}

/**
 * The same gates as a preHandler, for routes outside a workspace path that
 * still show workspace content: the workspace list and notifications.
 */
export const requirePicture: preHandlerHookHandler = async (request: FastifyRequest) => {
  assertReady(currentUser(request));
};

/**
 * Who the audit trail should name for this request.
 *
 * The one place that decides it, so when agents act through tokens (they
 * will record `kind: 'agent'`) no route has to change.
 */
export function auditActor(request: FastifyRequest): AuditActor {
  return { id: currentUser(request).id, kind: 'human', requestId: request.id };
}

/**
 * Populates `request.user` when a valid session cookie is present. Does not
 * reject -- routes opt into enforcement with `requireAuth`.
 */
/** The session token this request carries, under this app's cookie name. */
export function sessionToken(request: FastifyRequest): string | undefined {
  return request.cookies[request.server.sessionCookieName];
}

export function attachUser(db: Database): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const token = sessionToken(request);
    if (!token) return;

    // On a workspace route the membership comes in the same query (stage 3,
    // item 28), and `requireMembership` uses it rather than asking again.
    const { workspaceId } = (request.params ?? {}) as { workspaceId?: string };
    if (workspaceId) {
      const resolved = await resolveSessionIn(db, token, workspaceId);
      if (!resolved) return;
      request.user = resolved.user;
      request.resolvedRole = { workspaceId, role: resolved.role };
      return;
    }

    const user = await resolveSession(db, token);
    if (user) request.user = user;
  };
}

export const requireAuth: preHandlerHookHandler = async (request: FastifyRequest) => {
  if (!request.user) throw ApiError.unauthorized();
};

/**
 * Resolves the actor's membership of the workspace named in the path and
 * asserts it carries `permission`.
 *
 * Non-members get 404, not 403. A 403 would confirm that the workspace exists,
 * turning the endpoint into an oracle for enumerating workspace IDs; a
 * non-member should not be able to distinguish "not yours" from "not real".
 * Members who simply lack the permission do get 403, since they already know
 * the workspace exists.
 */
export function requireMembership(
  db: Database,
  permission: Permission,
  /**
   * For the one way out: leaving a workspace must not need a picture or an
   * answer about the terms, or someone who would rather not give one could
   * not leave.
   */
  { allowUnsettled = false }: { allowUnsettled?: boolean } = {},
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = currentUser(request);
    const { workspaceId } = request.params as { workspaceId?: string };

    if (!workspaceId) throw new Error('requireMembership used on a route without :workspaceId');

    // Shared with the WebSocket gateway, so both entry points answer the same
    // question the same way. Returns null for a malformed uuid too, which would
    // otherwise surface as a Postgres cast error and a 500.
    const resolved = request.resolvedRole;
    const member =
      resolved?.workspaceId === workspaceId
        ? resolved.role
          ? { role: resolved.role }
          : null
        : await findMembership(db, workspaceId, user.id);

    if (!member) throw ApiError.notFound('Workspace not found');
    // After the membership check, so a stranger still learns nothing: only a
    // member is told why they cannot go in yet.
    if (!allowUnsettled) assertReady(user);
    if (!can(member.role, permission)) throw ApiError.forbidden();

    request.membership = { workspaceId, role: member.role };
  };
}
