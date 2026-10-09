import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from './domain.ts';
import {
  CHANNEL_NAME_MAX_LENGTH,
  MEETING_MAX_MINUTES,
  MEETING_MIN_MINUTES,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './limits.ts';
import { ROLES } from './rbac.ts';
import { THEME_IDS } from './themes.ts';

/**
 * Wire contracts shared by the API and the web client. The API validates every
 * request body against these; the web client imports the inferred types so a
 * contract change is a compile error on both sides rather than a runtime 400.
 */

export const uuid = z.uuid();

/**
 * Deliberately permissive on composition and strict on length. Length is the
 * property that actually correlates with resistance to guessing, and character
 * -class rules mostly push users toward predictable substitutions.
 *
 * The bounds come from `./limits.ts`, which the client reads directly.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

/**
 * Changing your own name. Email is deliberately not editable here: it is the
 * login identifier and the invite key, so changing it needs a verification
 * round-trip that does not exist yet. Offering a field that silently breaks
 * both would be worse than not offering it.
 */
export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Changing a password requires the current one even though the caller is
 * already authenticated. A stolen session should not be upgradeable into
 * permanent account takeover, and knowing the old password is the one thing a
 * session thief does not have.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Asking for a reset link.
 *
 * The address is normalised the way registration does it, so `Ada@X.com`
 * finds the account stored as `ada@x.com`. A malformed address still gets the
 * same success response as a valid one, because the reply must not depend on
 * anything about the address.
 */
export const forgotPasswordSchema = z.object({
  // Trimmed and lowercased *before* the address is validated. The other way
  // round, " ada@x.com" fails validation and the caller gets the same silent
  // 202 as an unknown address, so a stray leading space looks like "no
  // account" and nobody ever finds out why no mail arrived.
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Spending a reset link. The token is opaque, so only its shape is checked. */
export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(500),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1).max(500),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const registerSchema = z.object({
  email: z.email().max(254).toLowerCase().trim(),
  name: z.string().trim().min(1).max(80),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email().max(254).toLowerCase().trim(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with single hyphens')
    .optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    theme: z.enum(THEME_IDS),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const inviteMemberSchema = z.object({
  email: z.email().max(254).toLowerCase().trim(),
  role: z.enum(ROLES),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const setMemberRoleSchema = z.object({
  role: z.enum(ROLES),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  key: z
    .string()
    .min(2)
    .max(6)
    .regex(/^[A-Z][A-Z0-9]*$/, 'Key must be uppercase letters and digits, starting with a letter')
    .optional(),
  description: z.string().max(2000).trim().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(2000).trim().nullable(),
    archived: z.boolean(),
  })
  .partial();

export const createIssueSchema = z.object({
  /**
   * Optional client-generated id. An offline client must be able to name an
   * issue the moment it is created -- to render it, reference it, and queue
   * edits against it -- long before the server has seen it. Letting the client
   * choose the uuid also makes create naturally idempotent: a replayed insert
   * collides on the primary key instead of producing a second row.
   */
  id: uuid.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).optional(),
  status: z.enum(ISSUE_STATUSES).default('TODO'),
  priority: z.enum(ISSUE_PRIORITIES).default('NONE'),
  assigneeId: uuid.nullable().optional(),
});
export type CreateIssueInput = z.infer<typeof createIssueSchema>;

/**
 * Every field optional so the board can PATCH a lone `status` on drag-drop.
 * `.refine` rejects `{}`, which would otherwise be an authorized no-op write.
 */
export const updateIssueSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(20_000).nullable(),
    status: z.enum(ISSUE_STATUSES),
    priority: z.enum(ISSUE_PRIORITIES),
    assigneeId: uuid.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;

export const listIssuesQuerySchema = z.object({
  status: z.enum(ISSUE_STATUSES).optional(),
  assigneeId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /**
   * Opaque keyset cursor, echoed back from a previous page.
   *
   * Not a row offset. `OFFSET n` re-counts from the start on every page, so an
   * insert between requests shifts every later row: the reader silently skips
   * one and sees another twice. A cursor names the last row seen, which is
   * stable regardless of what else is written.
   */
  cursor: z.string().max(200).optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  /** Optional: a document can hang off the workspace rather than a project. */
  projectId: uuid.nullable().optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z
  .object({ title: z.string().trim().min(1).max(200) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

/**
 * Channel names are normalised, not merely validated.
 *
 * `#General`, `#general ` and `#general` are the same room to a human, and a
 * unique index on the raw column would happily store all three. Lowercasing
 * and collapsing whitespace into hyphens on the way in means the index
 * enforces what people actually mean by "already taken".
 */
export const channelNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) => value.replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, ''))
  // Checked after the transform: stripping punctuation can empty a string
  // that looked fine, and `#` alone is not a channel name.
  .pipe(
    z
      .string()
      .min(1, 'Channel name must have at least one letter or number')
      .max(CHANNEL_NAME_MAX_LENGTH),
  );

export const createChannelSchema = z.object({
  name: channelNameSchema,
  topic: z.string().trim().max(200).nullable().optional(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z
  .object({
    name: channelNameSchema,
    topic: z.string().trim().max(200).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

export const createMessageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});
export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(MESSAGE_PAGE_SIZE),
  /** Names the oldest message already shown; the next page is older still. */
  cursor: z.string().max(200).optional(),
});

/**
 * A join link, if there is one.
 *
 * Restricted to `https` because these links are shown to the whole workspace
 * and clicked without much thought. Allowing arbitrary schemes would make the
 * field a stored-XSS vector via `javascript:` and a phishing surface via
 * anything else; `http` is excluded because a meeting link is a bearer
 * credential for a room.
 */
export const joinUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value === '' || /^https:\/\/\S+$/i.test(value), {
    message: 'Join link must be an https:// URL',
  })
  // Empty means "no link", which is a legitimate meeting (a room number, a
  // corridor) -- stored as null rather than an empty string.
  .transform((value) => (value === '' ? null : value));

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  agenda: z.string().trim().max(5000).nullable().optional(),
  /** ISO 8601, parsed to a Date here so the route never handles a raw string. */
  startsAt: z.coerce.date(),
  durationMinutes: z.coerce
    .number()
    .int()
    .min(MEETING_MIN_MINUTES)
    .max(MEETING_MAX_MINUTES)
    .default(30),
  joinUrl: joinUrlSchema.nullable().optional(),
  /** Who to invite. The organiser is added by the server regardless. */
  attendeeIds: z.array(uuid).max(200).optional(),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

export const updateMeetingSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    agenda: z.string().trim().max(5000).nullable(),
    startsAt: z.coerce.date(),
    durationMinutes: z.coerce.number().int().min(MEETING_MIN_MINUTES).max(MEETING_MAX_MINUTES),
    joinUrl: joinUrlSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

export const respondToMeetingSchema = z.object({
  response: z.enum(['yes', 'no', 'maybe']),
});
export type RespondToMeetingInput = z.infer<typeof respondToMeetingSchema>;

/**
 * The draft being typed, for duplicate suggestions.
 *
 * Bounded the same way `createIssueSchema` bounds a real issue, so a query
 * cannot be larger than the thing it is searching for.
 */
export const similarIssuesQuerySchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).nullable().optional(),
});
export type SimilarIssuesQuery = z.infer<typeof similarIssuesQuerySchema>;

/**
 * A page of the audit trail.
 *
 * `after` reads forwards from a seq (0 for the start), which is how an
 * exporter keeps its place. Otherwise the page is newest first, optionally
 * `before` a seq. Both at once has no sensible order, so it is refused.
 */
export const auditEventsQuerySchema = z
  .object({
    // Bounded so a huge number is a 400 here rather than a bigint overflow
    // in Postgres.
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    before: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    actorId: uuid.optional(),
    entityType: z
      .string()
      .regex(/^[a-z_]{1,40}$/)
      .optional(),
  })
  .refine((query) => query.after === undefined || query.before === undefined, {
    message: 'Use after or before, not both',
  });
export type AuditEventsQuery = z.infer<typeof auditEventsQuerySchema>;
