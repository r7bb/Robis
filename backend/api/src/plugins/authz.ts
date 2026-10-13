import { type AuthenticatedUser, resolveSession, SESSION_COOKIE } from '@robis/auth';
import { type AuditActor, type Database, findMembership } from '@robis/database';
import { can, type Permission, type Role } from '@robis/shared';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { ApiError } from '../errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    /** Set by `requireMembership`; the actor's role in the workspace on the path. */
    membership?: { workspaceId: string; role: Role };
  }
}

/** Narrowed request types so handlers don't re-check what a guard guaranteed. */
export type AuthedRequest = FastifyRequest & { user: AuthenticatedUser };
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
export function assertHasAvatar(user: AuthenticatedUser) {
  if (!user.hasAvatar) {
    throw new ApiError(403, 'avatar_required', 'Add a picture before you start');
  }
}

/**
 * The same gate as a preHandler, for routes outside a workspace path that
 * still show workspace content: the workspace list and notifications.
 */
export const requirePicture: preHandlerHookHandler = async (request: FastifyRequest) => {
  assertHasAvatar(currentUser(request));
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
export function attachUser(db: Database): preHandlerHookHandler {
  return async (request: FastifyRequest) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) return;

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
   * For the one way out: leaving a workspace must not need a picture, or
   * someone who would rather not add one could not leave.
   */
  { allowWithoutAvatar = false }: { allowWithoutAvatar?: boolean } = {},
): preHandlerHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const user = currentUser(request);
    const { workspaceId } = request.params as { workspaceId?: string };

    if (!workspaceId) throw new Error('requireMembership used on a route without :workspaceId');

    // Shared with the WebSocket gateway, so both entry points answer the same
    // question the same way. Returns null for a malformed uuid too, which would
    // otherwise surface as a Postgres cast error and a 500.
    const member = await findMembership(db, workspaceId, user.id);

    if (!member) throw ApiError.notFound('Workspace not found');
    // After the membership check, so a stranger still learns nothing: only a
    // member is told why they cannot go in yet.
    if (!allowWithoutAvatar) assertHasAvatar(user);
    if (!can(member.role, permission)) throw ApiError.forbidden();

    request.membership = { workspaceId, role: member.role };
  };
}
