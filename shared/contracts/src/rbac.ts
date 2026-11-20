/**
 * Authorization model.
 *
 * Every permission check in the API resolves to `can(role, permission)` against
 * the matrix below. Keeping it declarative means the rules are greppable, are
 * testable without spinning up routes, and can't drift between endpoints the
 * way scattered `if (role === 'ADMIN')` checks do.
 *
 * Rules that depend on more than the actor's role -- an admin may not demote an
 * owner, a workspace may not lose its last owner -- are *not* expressible here.
 * Those live in the member service alongside the data they need.
 */

export const ROLES = ['OWNER', 'ADMIN', 'MEMBER', 'GUEST'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',

  'member:read',
  'member:invite',
  'member:remove',
  'member:set_role',

  'project:create',
  'project:read',
  'project:update',
  'project:delete',

  'issue:create',
  'issue:read',
  'issue:update',
  'issue:delete',

  'comment:create',
  'comment:read',
  /** Delete a comment you authored. */
  'comment:delete_own',
  /** Delete anyone's comment (moderation). */
  'comment:delete_any',

  'channel:read',
  'channel:create',
  /** Rename a channel or change its topic. */
  'channel:update',
  'channel:delete',

  'message:create',
  /** Delete a message you wrote. */
  'message:delete_own',
  /** Delete anyone's message (moderation). */
  'message:delete_any',

  'meeting:read',
  'meeting:create',
  /** Reschedule or cancel a meeting you organised. */
  'meeting:manage_own',
  /** Reschedule or cancel anyone's meeting. */
  'meeting:manage_any',

  /** Read the full audit trail, export it, and verify its chain. */
  'audit:read',

  /** Attach an image to an issue or to your own comment. */
  'attachment:create',
  /** Remove an attachment you added. */
  'attachment:delete_own',
  /** Remove anyone's attachment (moderation). */
  'attachment:delete_any',

  /** Add and remove agents, and issue and revoke their tokens (B5). */
  'agent:manage',

  /** Post a story, seen by the workspace for 24 hours (B2). */
  'story:create',
  /** Take down a story you posted. */
  'story:delete_own',
  /** Take down anyone's story (moderation). */
  'story:delete_any',
  /** Turn stories on or off for the whole workspace. */
  'story:configure',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Read-only access shared by every role, including guests. */
const READ_ONLY: readonly Permission[] = [
  'workspace:read',
  'member:read',
  'project:read',
  'issue:read',
  'comment:read',
  'channel:read',
  'meeting:read',
];

/*
 * Guests talk.
 *
 * They can already comment on issues, so withholding chat would be an odd
 * line to draw: a guest contractor who can argue about a ticket but cannot
 * answer "are you free Thursday?" is a worse product and no safer. What they
 * still cannot do is create or reshape rooms.
 */
const GUEST: readonly Permission[] = [
  ...READ_ONLY,
  'comment:create',
  'comment:delete_own',
  // A guest who can describe a bug in a comment can show it in a screenshot.
  'attachment:create',
  'attachment:delete_own',
  'message:create',
  'message:delete_own',
];

const MEMBER: readonly Permission[] = [
  ...GUEST,
  'project:create',
  'project:update',
  'issue:create',
  'issue:update',
  'issue:delete',
  'channel:create',
  'meeting:create',
  'meeting:manage_own',
  // Guests see stories but do not post them: a contractor's window into a
  // team is its work, not its social side.
  'story:create',
  'story:delete_own',
];

const ADMIN: readonly Permission[] = [
  ...MEMBER,
  'workspace:update',
  'member:invite',
  'member:remove',
  'member:set_role',
  'project:delete',
  'comment:delete_any',
  'channel:update',
  'channel:delete',
  'message:delete_any',
  'meeting:manage_any',
  'attachment:delete_any',
  // Who did what is an administrator's question. Members still see the
  // workspace's activity feed; the full trail and its export are not theirs.
  'audit:read',
  // Who acts on the workspace's behalf is the same kind of question.
  'agent:manage',
  'story:delete_any',
];

/**
 * Owners differ from admins by being able to destroy the workspace, and by
 * deciding whether it has stories at all: what kind of place it is.
 */
const OWNER: readonly Permission[] = [...ADMIN, 'workspace:delete', 'story:configure'];

const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  MEMBER: new Set(MEMBER),
  GUEST: new Set(GUEST),
};

/**
 * The roles an agent may hold (B5). Never an admin's or an owner's: a token
 * that leaked could otherwise add people, remove them, or make more agents.
 */
export const AGENT_ROLES = ['MEMBER', 'GUEST'] as const satisfies readonly Role[];
export type AgentRole = (typeof AGENT_ROLES)[number];

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].has(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return [...MATRIX[role]];
}

/**
 * Ranking used for "you may not act on someone at or above your level" checks.
 * Higher number == more authority.
 */
const RANK: Record<Role, number> = { GUEST: 0, MEMBER: 1, ADMIN: 2, OWNER: 3 };

export function outranks(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target];
}

export function rankOf(role: Role): number {
  return RANK[role];
}
