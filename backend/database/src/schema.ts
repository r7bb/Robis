import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  LABEL_COLOURS,
  POST_REACTIONS,
  ROLES,
  SUGGESTION_ACTIONS,
  SUGGESTION_KINDS,
  USER_KINDS,
} from '@robis/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Raw binary column. Yjs updates are an opaque byte encoding, so they are
 * stored as `bytea` rather than base64 text -- no 33% size penalty, and no
 * encode/decode on every read.
 */
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/**
 * Full-text search vector.
 *
 * Declared as a stored generated column rather than maintained by a trigger or
 * by application code: Postgres recomputes it inside the same write, so it can
 * never drift from the row it describes and there is nothing to backfill after
 * a bug.
 */
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const id = () => uuid('id').primaryKey().defaultRandom();

/** A photo someone uploaded, or a pattern drawn from a seed. */
export const AVATAR_KINDS = ['photo', 'generated'] as const;
export const avatarKind = pgEnum('avatar_kind', AVATAR_KINDS);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum('role', ROLES);
export const userKindEnum = pgEnum('user_kind', USER_KINDS);
export const issueStatusEnum = pgEnum('issue_status', ISSUE_STATUSES);
export const issuePriorityEnum = pgEnum('issue_priority', ISSUE_PRIORITIES);

export const users = pgTable(
  'users',
  {
    id: id(),
    // Stored already-lowercased by the auth service; the unique index below is
    // on the raw column, so normalising on write is what actually prevents
    // `Ada@x.com` and `ada@x.com` becoming two accounts.
    email: text('email').notNull(),
    name: text('name').notNull(),
    /**
     * A person, or an agent an admin added to a workspace (B5). An agent
     * has no password anyone knows and never signs in: it acts only through
     * `agent_tokens`, and is marked as an agent wherever it appears.
     */
    kind: userKindEnum('kind').notNull().default('human'),
    /**
     * The app-specific `@handle`. Stored lowercase; the format is enforced by
     * `usernameSchema` at the edge and uniqueness by the index below. It is
     * what mentions, member lists and the audit trail name a person by, so
     * none of them carries an email address.
     */
    username: text('username').notNull(),
    /**
     * The username as uniqueness sees it: no dots or underscores, 0 read as
     * o and 1 as l (`usernameKey` in the contracts says the same in code).
     * Derived by Postgres, so no insert can forget it, and unique, so
     * `ada.l` and `ada_l` cannot both exist.
     */
    usernameKey: text('username_key').generatedAlwaysAs(
      sql`translate(replace(replace(lower(username), '.', ''), '_', ''), '01', 'ol')`,
    ),
    /**
     * The profile picture: an uploaded photo (`avatar_ref` is its storage
     * key) or a generated one (`avatar_ref` is the seed it is drawn from).
     * Null until the person picks one; the app asks before anything else.
     */
    avatarKind: avatarKind('avatar_kind'),
    avatarRef: text('avatar_ref'),
    /** Changes with every new picture, so a cached old one is not shown. */
    avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
    passwordHash: text('password_hash').notNull(),
    /**
     * When the account was deleted (stage 1, item 10). The row stays, emptied
     * of everything personal, because what the person wrote in shared
     * workspaces still points at it.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * When this address was confirmed, or null if it never was.
     *
     * A timestamp rather than a boolean: "verified" and "verified on the third
     * of March" cost the same to store, and the second can answer questions
     * about an account later. Joining a workspace needs it: an invitation
     * cannot be accepted from an unconfirmed address.
     */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /**
     * What the person agreed to and when: the minimum-age confirmation and
     * the terms version (`TERMS_VERSION`), stored at sign-up and again each
     * time they are asked. Null for accounts from before this was kept, who
     * are asked once. Personal data; the retention question is part of the
     * legal review flagged in the README.
     */
    ageConfirmedAt: timestamp('age_confirmed_at', { withTimezone: true }),
    termsVersion: text('terms_version'),
    termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
    /**
     * When the person last chose or kept their username. Null for accounts
     * whose name was given to them (by migration 0012 or 0022), who are
     * asked once to keep it or pick another.
     */
    usernameConfirmedAt: timestamp('username_confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_username_key').on(t.username),
    uniqueIndex('users_username_key_key').on(t.usernameKey),
  ],
);

/**
 * Usernames people have let go of, each held for a while before anyone
 * else may claim it.
 *
 * Without this, renaming frees a name at once, and whoever takes it next
 * inherits how every old `@mention` of it reads. Only the previous owner
 * may take a name back while it is held. Erasing a person (see
 * `audit-redaction.ts`) clears `username` and `user_id` but keeps the key
 * and the hold, so the erasure does not hand the name to someone else.
 */
export const usernameHistory = pgTable(
  'username_history',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username'),
    usernameKey: text('username_key').notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
    heldUntil: timestamp('held_until', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('username_history_key_idx').on(t.usernameKey, t.heldUntil),
    index('username_history_user_idx').on(t.userId),
  ],
);

/**
 * A sign-up that has been started and not finished (email-first sign-up).
 *
 * Starting one only names an address; the link mailed to it is what
 * finishes it, so an address is proved before an account exists, and the
 * form never says whether one already does. One row per request, each
 * holding only the hash of its own link, issued by the worker when it sends
 * the mail (so the link itself is never stored). Asking again adds a row
 * rather than replacing one, so a stranger typing your address cannot
 * cancel the link you hold. Finishing deletes every row for the address.
 */
export const signups = pgTable(
  'signups',
  {
    id: id(),
    /** Lowercased, as account addresses are. */
    email: text('email').notNull(),
    tokenHash: text('token_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('signups_email_idx').on(t.email),
    uniqueIndex('signups_token_hash_key').on(t.tokenHash),
  ],
);

/** What a one-time token is for. Narrow, so the column cannot drift. */
export const AUTH_TOKEN_PURPOSES = [
  'password_reset',
  'email_verification',
  // The "this was not me" link in a new-device alert (C4).
  'not_me',
] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const authTokenPurposeEnum = pgEnum('auth_token_purpose', AUTH_TOKEN_PURPOSES);

/**
 * Single-use tokens for password reset and email verification.
 *
 * One table with a `purpose` rather than two tables, because both flows are
 * the same shape: a hashed secret belonging to a user that expires and works
 * once. Two tables would be this schema written twice.
 *
 * Only the SHA-256 of the token is stored, for the same reason sessions do it:
 * the row is useless to whoever reads the database, and the only copy of the
 * secret is in the message that was sent. Plain SHA-256 rather than Argon2 is
 * right here because the input is 256 bits of randomness -- there is nothing
 * to brute-force.
 *
 * Single use is enforced by deleting the row rather than by a `consumed_at`
 * flag: nothing is then left to replay, and there is no second state to get
 * wrong.
 */
export const authTokens = pgTable(
  'auth_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurposeEnum('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // Lookup is always by the hash of a presented token.
    uniqueIndex('auth_tokens_token_hash_key').on(t.tokenHash),
    /*
     * One live token per user per purpose, enforced rather than assumed.
     *
     * Issuing used to delete the previous row and insert a new one, which
     * under READ COMMITTED lets two concurrent requests both delete nothing
     * and both insert, leaving two live links. A unique index turns that into
     * an upsert with one winner.
     */
    uniqueIndex('auth_tokens_user_purpose_key').on(t.userId, t.purpose),
    // The cleanup job sweeps by expiry.
    index('auth_tokens_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Opaque server-side sessions rather than stateless JWTs.
 *
 * The tradeoff is a database read per request, which is cheap and indexed. What
 * it buys is immediate revocation -- signing a user out, or kicking every
 * session after a password change -- which a self-contained JWT cannot do
 * without a denylist that reintroduces the same lookup.
 *
 * Only the SHA-256 of the token is stored, so a database leak does not hand the
 * attacker usable session cookies.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
    // For the hourly removal of expired sessions (stage 3, item 29).
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * Two-factor sign-in with an authenticator app (C4), one row per account.
 * The secret is sealed with `TWO_FACTOR_KEY` (see `sealSecret`), never kept
 * plain: unlike a password it cannot be hashed, since checking a code needs
 * it. Until `confirmed_at` the row is a setup in progress and asks nothing
 * at sign-in. `last_step` is the time step of the last code taken, and a
 * code is taken only for a later step, so each works once.
 */
export const twoFactor = pgTable('two_factor', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  secretSealed: text('secret_sealed').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  lastStep: bigint('last_step', { mode: 'number' }),
  createdAt: createdAt(),
});

/**
 * Recovery codes (C4), stored as hashes and spent by setting `used_at`, so
 * the account page can say how many are left. A new set replaces the old.
 */
export const recoveryCodes = pgTable(
  'recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('recovery_codes_user_hash_key').on(t.userId, t.codeHash)],
);

/**
 * A sign-in halfway done (C4): the password was right and the second step
 * is owed. Short-lived, held as a hash, and good for a few wrong codes
 * before it is gone and the password must be given again.
 */
/**
 * The browsers a person has signed in from (C4), each known by a random
 * cookie of its own, kept here only as its hash. A sign-in from one not
 * listed, on an account that has signed in before, mails an alert. Nothing
 * else about the browser is kept here: the alert reads it from the session.
 */
export const knownDevices = pgTable(
  'known_devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceHash: text('device_hash').notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('known_devices_user_device_key').on(t.userId, t.deviceHash),
    // Whether a cookie was ever given out, by any account (see noteDevice).
    index('known_devices_device_hash_idx').on(t.deviceHash),
    // For removing devices not seen in over a year.
    index('known_devices_last_seen_idx').on(t.lastSeenAt),
  ],
);

/**
 * Passkeys (C4): a credential on a phone, laptop or security key, for
 * signing in without a password. Only the public half is here; the private
 * half never leaves the device. `counter` is the authenticator's own count
 * of uses, which must keep rising where it is kept at all.
 */
export const passkeys = pgTable(
  'passkeys',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The credential's id, base64url, as the browser sends it back. */
    credentialId: text('credential_id').notNull(),
    /** The COSE public key, base64url. */
    publicKey: text('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    /** How the browser can reach it (internal, usb, hybrid...), as JSON. */
    transports: text('transports'),
    /** What its owner called it, to tell several apart. */
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('passkeys_credential_id_key').on(t.credentialId),
    index('passkeys_user_id_idx').on(t.userId),
  ],
);

/**
 * A WebAuthn challenge waiting for its answer (C4), spent once. A sign-in's
 * has no person yet: whoever's passkey answers it is the one signing in.
 */
export const passkeyChallenges = pgTable(
  'passkey_challenges',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** 'register' or 'sign_in'. */
    purpose: text('purpose').notNull(),
    challenge: text('challenge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('passkey_challenges_expires_at_idx').on(t.expiresAt)],
);

export const signInChallenges = pgTable(
  'sign_in_challenges',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sign_in_challenges_token_hash_key').on(t.tokenHash),
    index('sign_in_challenges_user_id_idx').on(t.userId),
    index('sign_in_challenges_expires_at_idx').on(t.expiresAt),
  ],
);

/**
 * The keys an agent acts with (B5): each scoped to one workspace, shown once
 * when issued and stored only as a hash, like a session. Revoking one sets
 * `revoked_at`, and the next request carrying it is refused, since every
 * request looks the token up.
 */
export const agentTokens = pgTable(
  'agent_tokens',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    /** What the admin called it, so a list of tokens can be told apart. */
    label: text('label').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    /** Null for a token that lasts until revoked; set for one minted for a single run. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('agent_tokens_token_hash_key').on(t.tokenHash),
    index('agent_tokens_agent_id_idx').on(t.agentId),
    index('agent_tokens_workspace_id_idx').on(t.workspaceId),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /**
     * Presentation only, so it is a plain string rather than an enum: adding a
     * theme should be a code change, not a migration, and an id the client no
     * longer recognises falls back rather than failing.
     */
    theme: text('theme').notNull().default('midnight'),
    /**
     * The agent that triages new issues here, if any (B5): it comments
     * suggested duplicates and a priority on each, and changes nothing.
     */
    triageAgentId: uuid('triage_agent_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /**
     * Whether the triage agent may add a one-line summary from a language
     * model (B5). Off unless an admin turns it on: with it, an issue's title
     * and description are sent to a third-party service.
     */
    triageSummaries: boolean('triage_summaries').notNull().default(false),
    /**
     * Whether everyone here must sign in with two-factor (C4). An admin who
     * turns it on must have it; a member without it is refused at every
     * workspace route and on the live feed, with a way to turn it on.
     */
    requireTwoFactor: boolean('require_two_factor').notNull().default(false),
    /**
     * Whether people here may post stories (B2). On unless an owner turns
     * it off; off hides the stories there are and refuses new ones.
     */
    storiesEnabled: boolean('stories_enabled').notNull().default(true),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug)],
);

/**
 * The tenancy join table. Membership *is* authorization: if there is no row
 * here for (workspace, user), the user cannot see the workspace exists, and the
 * API returns 404 rather than 403 so workspace IDs aren't enumerable.
 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull().default('MEMBER'),
    /**
     * A profile in this workspace (B2), each part optional and the person's
     * own: what they do here ("Design lead") and what they are on now. Per
     * workspace, as the same person can be a different person to each team.
     */
    title: text('title'),
    workingOn: text('working_on'),
    /** A cover photo for that profile, in the storage port; members only. */
    coverKey: text('cover_key'),
    coverUpdatedAt: timestamp('cover_updated_at', { withTimezone: true }),
    /** When they last reached the end of the feed (Phase 2c): what is new is after it. */
    feedSeenAt: timestamp('feed_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_id_idx').on(t.userId),
  ],
);

/**
 * Someone asked into a workspace who has not answered yet.
 *
 * Membership needs the person's own yes: an admin's invitation lands
 * here, the invited person sees it and accepts (which needs a confirmed
 * email address) or declines, and only then does a `workspace_members`
 * row exist. Answering or withdrawing it deletes the row; the audit trail
 * keeps what happened.
 *
 * Either for a person (by username) or for an address (by email), never
 * both. An address is kept as typed and never resolved to an account here:
 * whether the address has one must not show, to the inviter or in this
 * table. It is matched to an account only by that account's confirmed
 * address, when the person looks.
 */
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Lowercased, as account addresses are. */
    email: text('email'),
    role: roleEnum('role').notNull().default('MEMBER'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('workspace_invitations_workspace_user_key')
      .on(t.workspaceId, t.userId)
      .where(sql`${t.userId} is not null`),
    uniqueIndex('workspace_invitations_workspace_email_key')
      .on(t.workspaceId, t.email)
      .where(sql`${t.email} is not null`),
    index('workspace_invitations_user_idx').on(t.userId),
    index('workspace_invitations_email_idx').on(t.email),
    index('workspace_invitations_invited_by_idx').on(t.invitedBy),
    check(
      'workspace_invitations_one_addressee',
      sql`(${t.userId} is null) <> (${t.email} is null)`,
    ),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Short uppercase prefix for issue identifiers, e.g. `REL` in `REL-104`. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    archived: boolean('archived').notNull().default(false),
    /**
     * Per-project issue counter. Incremented with `UPDATE ... RETURNING` inside
     * the issue-creation transaction, which takes a row lock and therefore
     * serialises concurrent creates. A shared Postgres sequence would be faster
     * but would leave gaps and is not per-project.
     */
    issueCounter: integer('issue_counter').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_workspace_key_key').on(t.workspaceId, t.key),
    index('projects_workspace_id_idx').on(t.workspaceId),
  ],
);

export const issues = pgTable(
  'issues',
  {
    id: id(),
    /**
     * Denormalised from `projects`. Every tenant-scoped query filters on this
     * directly, which keeps the authorization predicate on the same table as
     * the row being read -- no join to get right, and nothing to forget.
     */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Sequential within the project; renders as `${project.key}-${number}`. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: issueStatusEnum('status').notNull().default('TODO'),
    priority: issuePriorityEnum('priority').notNull().default('NONE'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * The agent that last acted on this issue, beside its human assignee
     * (B5). The assignee is always a person; an agent is recorded here
     * instead, so who answers for the work never changes hands to a bot.
     */
    delegateId: uuid('delegate_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Where the card sits on the board (C1): a fractional key, so moving one
     * card between two others writes that card alone. Ascending is top to
     * bottom; a new issue takes a key before the project's first.
     */
    position: text('position').notNull(),
    /** The day it is due (C1): a calendar date, not a moment, so it is the
     * same day wherever it is read. */
    dueOn: date('due_on', { mode: 'string' }),
    /** The issue this is a part of (C1): one in the same project, never
     * itself or its own descendant. Deleting the parent leaves its
     * sub-issues standing on their own. */
    parentId: uuid('parent_id').references((): AnyPgColumn => issues.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Weight A for the title, B for the body: a term in the title is a
     * stronger match than the same term buried in a description. */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
  },
  (t) => [
    uniqueIndex('issues_project_number_key').on(t.projectId, t.number),
    index('issues_workspace_id_idx').on(t.workspaceId),
    // The home's overview: the latest issue per workspace, and the last two
    // weeks of creations and edits (routes/overview.ts).
    index('issues_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('issues_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
    index('issues_project_status_idx').on(t.projectId, t.status),
    // Matches the keyset page query's filter and ordering exactly, so
    // paging stays an index scan instead of a sort.
    index('issues_project_created_idx').on(t.projectId, t.createdAt, t.id),
    index('issues_assignee_idx').on(t.assigneeId),
    index('issues_project_position_idx').on(t.projectId, t.position),
    index('issues_parent_idx').on(t.parentId),
    check('issues_parent_not_self', sql`${t.parentId} <> ${t.id}`),
    index('issues_search_idx').using('gin', t.searchVector),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(body, ''))`,
    ),
  },
  (t) => [
    index('comments_issue_id_idx').on(t.issueId, t.createdAt),
    // The home's overview, as for issues.
    index('comments_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('comments_search_idx').using('gin', t.searchVector),
  ],
);

/**
 * Who each `@handle` in a comment meant, decided when it was written.
 *
 * The comment keeps its words; this keeps the people. A later rename, or a
 * new person taking an old name, changes neither: the mention still points
 * at whoever held the handle in that workspace at the time.
 */
export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The handle as written, lowercased, so the text can be matched to it. */
    handle: text('handle').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.handle] }),
    index('comment_mentions_user_idx').on(t.userId),
  ],
);

/**
 * Images attached to an issue, or to one comment on it.
 *
 * The bytes live in object storage under `storage_key`; this row is the only
 * way to reach them, through a route that checks membership first. Rows go
 * with their issue, comment or workspace by cascade, and the code that
 * deletes those queues a job to remove the files, since a cascade cannot.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'set null' }),
    storageKey: text('storage_key').notNull(),
    contentType: text('content_type').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attachments_storage_key_key').on(t.storageKey),
    index('attachments_issue_created_idx').on(t.issueId, t.createdAt),
    index('attachments_workspace_idx').on(t.workspaceId),
  ],
);

/** What a story is: a picture, or a few words on a colour (B2). */
export const STORY_KINDS = ['photo', 'text'] as const;

/**
 * A story (B2): a photo or a short text, seen by the workspace for 24 hours.
 *
 * Expiry is checked on every read, so a story past `expires_at` is gone to
 * everyone at once, whether or not the job that deletes it has run. That
 * job removes the row and queues its file; until then the row is only
 * waiting to go. Text is a person's own words, so it never enters the
 * audit trail: the trail records that a story was added, not what it said.
 */
export const stories = pgTable(
  'stories',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: STORY_KINDS }).notNull(),
    /** A text story's words. */
    body: text('body'),
    /** A text story's background, by name from a fixed list. */
    tone: text('tone'),
    /** A photo story's file, and what it is. */
    storageKey: text('storage_key'),
    contentType: text('content_type'),
    bytes: integer('bytes'),
    width: integer('width'),
    height: integer('height'),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('stories_storage_key_key').on(t.storageKey),
    index('stories_workspace_expires_idx').on(t.workspaceId, t.expiresAt),
    index('stories_author_idx').on(t.authorId),
    index('stories_expires_idx').on(t.expiresAt),
    check(
      'stories_kind_fields',
      sql`(${t.kind} = 'photo' and ${t.storageKey} is not null and ${t.body} is null) or (${t.kind} = 'text' and ${t.storageKey} is null and ${t.body} is not null)`,
    ),
  ],
);

/** What a feed post is (Phase 2c): words, a photo (with words or not), or a check-in answer. */
export const POST_KINDS = ['text', 'photo', 'checkin'] as const;

/**
 * A post on the workspace's feed (Phase 2c). Kept like a message: it stays
 * when its author leaves, and goes with its workspace. A photo is in the
 * storage port; the code that deletes a post or its workspace queues the
 * file, since a cascade cannot.
 */
export const posts = pgTable(
  'posts',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: POST_KINDS }).notNull(),
    /** The words, or a photo's caption; empty for a photo with none. */
    body: text('body').notNull().default(''),
    photoKey: text('photo_key'),
    photoContentType: text('photo_content_type'),
    photoBytes: integer('photo_bytes'),
    photoWidth: integer('photo_width'),
    photoHeight: integer('photo_height'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('posts_workspace_created_idx').on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    index('posts_author_idx').on(t.authorId),
    uniqueIndex('posts_photo_key_key').on(t.photoKey),
    check('posts_kind_fields', sql`(${t.kind} = 'photo') = (${t.photoKey} is not null)`),
  ],
);

export const postComments = pgTable(
  'post_comments',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('post_comments_post_created_idx').on(t.postId, t.createdAt)],
);

/** Who reacted to a post, and how: one row per person per reaction. */
export const postReactions = pgTable(
  'post_reactions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reaction: text('reaction', { enum: POST_REACTIONS }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId, t.reaction] })],
);

/** Who acted: a person, an agent acting through a token, or Robis itself. */
export const ACTOR_KINDS = ['human', 'agent', 'system'] as const;
export const actorKind = pgEnum('actor_kind', ACTOR_KINDS);

/**
 * Append-only activity trail. Written in the same transaction as the mutation
 * it describes, so an event exists if and only if the change committed.
 *
 * Tamper-evident, per workspace: `seq` counts 1, 2, 3 with no gaps, and each
 * row's `hash` covers its own fields and the previous row's hash. Editing or
 * deleting a row breaks the chain at that point, unless whoever did it also
 * rewrote every later row; an outside copy catches that. See `audit.ts`.
 *
 * `actor_id` deliberately has no foreign key. With `ON DELETE SET NULL`,
 * deleting an account would rewrite every row it appears in, which is both
 * an edit to a hashed field and a trail that forgets who did what. The trail
 * is meant to outlive the account.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    actorId: uuid('actor_id'),
    actorKind: actorKind('actor_kind').notNull().default('human'),
    /** The API request that caused it, to join the trail against logs. */
    requestId: text('request_id'),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    /** The previous event's hash; null only for the first event. */
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    /** The key that signed the hash; null for an event from before signing. */
    keyId: text('key_id'),
    /**
     * Personal fields about someone, kept outside the hashed payload so they
     * can be erased (see `audit-redaction.ts`). The hash covers only
     * `personal_commitment`, a SHA-256 of the salt and the fields, which
     * stays when the fields, the salt and the subject are erased.
     */
    personal: text('personal'),
    personalSalt: text('personal_salt'),
    /** Whose fields they are, so a request about one person finds them all. */
    personalSubjectId: uuid('personal_subject_id'),
    personalCommitment: text('personal_commitment'),
  },
  (t) => [
    uniqueIndex('audit_events_workspace_seq_key').on(t.workspaceId, t.seq),
    // The security view's two filters. Without these, asking for a rarely
    // seen actor walks the workspace's whole chain before filling a page.
    index('audit_events_workspace_actor_seq_idx').on(t.workspaceId, t.actorId, t.seq),
    index('audit_events_workspace_entity_seq_idx').on(t.workspaceId, t.entityType, t.seq),
    // Null is unsigned; anything else must look like a key id, so no value
    // (an empty string, say) can sit between the two.
    check(
      'audit_events_key_id_format',
      sql`${t.keyId} is null or ${t.keyId} ~ '^[a-z0-9-]{1,32}$'`,
    ),
    // Personal fields only ever come with a commitment to them, and the
    // subject index finds every event an erasure has to reach.
    check(
      'audit_events_personal_committed',
      sql`(${t.personal} is null and ${t.personalSalt} is null) or ${t.personalCommitment} is not null`,
    ),
    index('audit_events_personal_subject_idx').on(t.personalSubjectId),
  ],
);

/**
 * The last point at which a workspace's chain was verified, so the next
 * check walks only what came after.
 *
 * Signed, like the events: `mac` is an HMAC over the workspace, seq, hash
 * and signed flag with the key named by `key_id`, so a checkpoint moved or
 * invented by someone with database access is rejected and the check falls
 * back to walking the whole chain.
 */
export const auditCheckpoints = pgTable('audit_checkpoints', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  hash: text('hash').notNull(),
  /** Whether any event up to `seq` was signed, which the walk on needs. */
  signed: boolean('signed').notNull(),
  keyId: text('key_id').notNull(),
  mac: text('mac').notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What is left of a workspace's trail after the workspace is deleted.
 *
 * Deleting a workspace cascades to its audit events, so on its own a
 * deletion would leave no trace in the database. A trigger on `workspaces`
 * (migration 0017), running with the owner's rights, writes the trail's
 * length and final hash here first. The runtime role may only read this
 * table, and like the trail it refuses edits and removal.
 */
/**
 * One account's own trail: signing in, failing to, signing out, changing
 * or resetting the password, revoking sessions.
 *
 * These belong to a person rather than to any workspace, so they are a
 * chain per account, numbered and signed exactly as workspace events are
 * (see `account-trail.ts`), append-only by trigger and by the runtime
 * role's grants, and shown only to the account holder.
 */
export const accountEvents = pgTable(
  'account_events',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull().default(sql`'{}'`),
    requestId: text('request_id'),
    createdAt: createdAt(),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    keyId: text('key_id').notNull(),
  },
  (t) => [
    uniqueIndex('account_events_user_seq_key').on(t.userId, t.seq),
    check('account_events_key_id_format', sql`${t.keyId} ~ '^[a-z0-9-]{1,32}$'`),
  ],
);

/**
 * A record of each erasure (stage 1, item 9): when, how much it removed,
 * and a commitment to whom, never the person. The commitment is a SHA-256
 * of the person's id and a random nonce that only the operator keeps, with
 * the request; with both, it proves which erasure answered which request,
 * and without the nonce it names nobody. Written only by `audit:erase`'s
 * own role; the app cannot read or write it.
 */
/**
 * Erasures asked for and not yet done (stage 1, item 10). Deleting an
 * account files one; the app may only add rows, and only `audit:erase`'s
 * role (`processErasureRequests`) reads them and carries them out, so the
 * app never holds the right to erase.
 */
export const erasureRequests = pgTable('erasure_requests', {
  id: id(),
  subjectId: uuid('subject_id').notNull(),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const erasures = pgTable('erasures', {
  id: id(),
  erasedAt: timestamp('erased_at', { withTimezone: true }).notNull().defaultNow(),
  commitment: text('commitment').notNull(),
  auditEventsErased: integer('audit_events_erased').notNull(),
  usernamesForgotten: integer('usernames_forgotten').notNull(),
});

export const auditTombstones = pgTable('audit_tombstones', {
  id: id(),
  workspaceId: uuid('workspace_id').notNull(),
  /** The last event's seq and hash, or 0 and null for an empty trail. */
  headSeq: bigint('head_seq', { mode: 'number' }).notNull(),
  headHash: text('head_hash'),
  /** The database role that ran the delete. */
  deletedBy: text('deleted_by').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * How far the SIEM stream has delivered, per workspace.
 *
 * Advanced only after the receiver acknowledges a batch, so a crash between
 * the two resends rather than skips. Each event carries its id as an
 * idempotency key for exactly that case.
 */
export const auditStreamCursors = pgTable('audit_stream_cursors', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  deliveredSeq: bigint('delivered_seq', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Collaboratively edited documents, stored as Yjs CRDT state.
 *
 * The content is not text but an opaque binary encoding of the CRDT, because
 * the merge rules live in the data structure rather than in the server. That is
 * the whole point: two people editing the same paragraph while offline both
 * keep their edit, and every replica reaches the same result regardless of the
 * order updates arrive in. Storing plain text would force the server to pick a
 * winner, which is the thing CRDTs exist to avoid.
 */
export const documents = pgTable(
  'documents',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Optional: a document can belong to the workspace rather than a project. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /**
     * Compacted CRDT state. Reading a document means this plus every row in
     * `document_updates` recorded after it.
     */
    snapshot: bytea('snapshot'),
    /**
     * Plain-text mirror of the document, written by the gateway when it
     * persists. The content itself is an opaque CRDT encoding that Postgres
     * cannot read, so search needs a rendered copy -- kept alongside rather
     * than derived, because only the editor knows how to render it.
     */
    searchText: text('search_text'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(search_text, '')), 'B')`,
    ),
  },
  (t) => [
    index('documents_workspace_idx').on(t.workspaceId),
    index('documents_project_idx').on(t.projectId),
    index('documents_search_idx').using('gin', t.searchVector),
  ],
);

/**
 * Append-only log of CRDT updates.
 *
 * Writing a new full snapshot on every keystroke would rewrite the entire
 * document for a one-character change. Appending the update instead makes a
 * write proportional to the edit, and Yjs merges the log back into a snapshot
 * cheaply -- see `compactDocument`.
 *
 * `seq` is a bigserial rather than a timestamp: updates must be replayed in the
 * order the server accepted them, and two updates can share a millisecond.
 */
export const documentUpdates = pgTable(
  'document_updates',
  {
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    update: bytea('update').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('document_updates_document_seq_idx').on(t.documentId, t.seq)],
);

/**
 * Background job queue.
 *
 * Postgres rather than Redis + BullMQ, for the same reason `NOTIFY` replaced
 * Redis pub/sub: enqueueing can join the transaction that caused it. A comment
 * insert and the notification job it schedules commit together or not at all,
 * so there is no window where the comment exists and the job was lost, or the
 * job fires for a comment that rolled back. An external broker cannot offer
 * that without an outbox table -- which is what this already is.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so N workers take disjoint batches
 * without blocking each other or needing a coordinator.
 *
 * What Postgres does not give: this polls rather than blocking on a socket, so
 * latency is bounded by the poll interval, and throughput is bounded by the
 * database. At the point either of those hurts, a dedicated broker is the
 * answer -- but the enqueue-in-transaction guarantee is worth giving up last.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    payload: text('payload').notNull().default(sql`'{}'`),
    /** Earliest time this may run. Backoff pushes it forward on failure. */
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    /**
     * Set when a worker claims the job. A crashed worker leaves this behind,
     * so anything held past the visibility timeout is reclaimed.
     */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    /** `pending` until it exhausts its attempts, then `failed` (dead letter). */
    status: text('status').notNull().default('pending'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    // The claim query's predicate and ordering (stage 3, item 29): pending
    // jobs only, by when they are due. Finished and dead jobs, most of the
    // table in time, are not in it, so it stays small as the table grows.
    index('jobs_pending_run_at_idx').on(t.runAt).where(sql`${t.status} = 'pending'`),
    // At most one waiting email per account and kind. Asking again while one
    // is queued, retrying or in flight adds nothing, so neither a resend
    // button nor a burst of sign-ups can stack up mail for one inbox.
    uniqueIndex('jobs_pending_mail_once')
      .on(t.kind, t.payload)
      .where(sql`${t.status} = 'pending' and ${t.kind} like 'mail.%'`),
  ],
);

/**
 * A thing that happened which someone should see.
 *
 * Written by a worker rather than in the request that caused it: fanning out
 * to every mentioned user inline would make posting a comment slower the more
 * people it mentions, and a failure in notification delivery would roll back
 * the comment itself.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    /** Null for notifications that are not about a workspace, such as a nudge
     * telling someone to create their first one. */
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Recipient. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    entityType: text('entity_type').notNull(),
    /** Null for notifications that are not about a row, such as nudges. */
    entityId: uuid('entity_id'),
    /**
     * Collision key for "do not send this twice".
     *
     * A mention uses the comment id, so redelivering the job is a no-op. A
     * nudge uses its kind plus a time bucket, so it can recur next week but
     * never twice in the same one. Encoding the rule in the value rather than
     * the index is what lets those two very different policies share one
     * constraint.
     */
    dedupeKey: text('dedupe_key').notNull(),
    payload: text('payload').notNull().default(sql`'{}'`),
    /**
     * Shown in the inbox (C3). False when its kind is off in the app but on
     * in another channel: the row is still what an email or a push is made
     * from, so it is kept, but the inbox never lists it.
     */
    inApp: boolean('in_app').notNull().default(true),
    /**
     * By email (C3): `now` (a mention, sent by its own job), `digest` (in
     * the day's summary) or null (not by email). Decided from the settings
     * when it is made, and checked again when it is sent.
     */
    emailDue: text('email_due'),
    /** When it went by email, or was passed over because its email was turned off. */
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    /** When it was pushed to its person's devices (C3); a retry after that pushes nothing. */
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // Unread-first inbox for one user, which is the only way this is read.
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    uniqueIndex('notifications_dedupe_key').on(t.userId, t.dedupeKey),
    // What the next digests hold: small, as a row leaves it once mailed.
    index('notifications_digest_due_idx')
      .on(t.userId)
      .where(sql`${t.emailDue} = 'digest' and ${t.emailedAt} is null`),
    check('notifications_email_due', sql`${t.emailDue} in ('now', 'digest')`),
  ],
);

/**
 * A browser that takes web pushes for someone (C3). Only its endpoint is
 * kept: a push carries nothing, so the keys a browser offers for encrypting
 * one are not needed and not stored. The endpoint is unique, as it names
 * one browser; signing in as someone else there moves it to them.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('push_subscriptions_endpoint_key').on(t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

/**
 * One summary email per person per day (C3). The row is written before the
 * mail is sent, holding the notifications it is about, so a retried job
 * sends the same email and a finished one (`sent_at`) sends nothing: a
 * digest job retried three times sends one email. The day is a UTC date.
 */
export const emailDigests = pgTable(
  'email_digests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    /** The notification ids it is about, as a JSON array: fixed when it is first claimed. */
    notificationIds: text('notification_ids').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.day] }),
    index('email_digests_created_idx').on(t.createdAt),
  ],
);

/**
 * The links in notification emails that stop them without signing in (C3).
 * A token does one thing: turns email off for the kinds it names, for its
 * owner. Stored as a hash, like a reset token; used once, then deleted;
 * expires after a while (`UNSUBSCRIBE_TOKEN_DAYS`). One per email, so an
 * older email's link still works after a newer one is sent.
 */
export const unsubscribeTokens = pgTable(
  'unsubscribe_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The kinds it turns email off for, as a JSON array. */
    kinds: text('kinds').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('unsubscribe_tokens_expires_idx').on(t.expiresAt)],
);

/**
 * What someone has turned off (C3), by kind and channel. Everything starts
 * on, so a row is written only for a choice, and `enabled` says which way:
 * turning a channel back on writes true rather than deleting, so the row
 * says when the choice was last made.
 */
export const notificationSettings = pgTable(
  'notification_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.kind, t.channel] }),
    check(
      'notification_settings_kind',
      sql`${t.kind} in ('mention', 'assignment', 'issue_comment', 'meeting', 'nudge')`,
    ),
    check('notification_settings_channel', sql`${t.channel} in ('in_app', 'email', 'push')`),
  ],
);

/**
 * Idempotency ledger.
 *
 * An offline client retries whatever is still in its queue when it reconnects,
 * and it cannot tell a request that never arrived from one whose response was
 * lost. Without this table, "create issue" retried after an ambiguous failure
 * produces two issues.
 *
 * Each mutation carries a client-generated key. The first request inserts a
 * `pending` row (the primary key is the lock), does the work, then stores its
 * response. A replay finds the row and returns the stored response instead of
 * re-applying.
 */
export const mutations = pgTable(
  'mutations',
  {
    /** Client-generated. Unique across all users; `userId` is checked too so
     * one account cannot probe or hijack another's keys. */
    key: text('key').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Hash of method + path + body. Reusing a key with a different payload is a
     * client bug, and silently returning the old response would hide it.
     */
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull().default('pending'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    createdAt: createdAt(),
  },
  (t) => [index('mutations_user_created_idx').on(t.userId, t.createdAt)],
);

/**
 * Workspace chat channels.
 *
 * Robis already had threaded comments, but a comment hangs off an issue:
 * there was nowhere to say something that is not about one piece of work.
 * Channels are that place -- a per-workspace room list, each room an ordered
 * log of messages.
 *
 * Deliberately not direct messages. DMs need a different privacy story (who
 * may read the transcript, what an export contains, what happens when
 * somebody leaves the workspace) and bolting them onto a workspace-scoped
 * table would answer those questions badly and silently. A channel is
 * readable by exactly the people who can read the workspace -- a rule that
 * already exists, and is already tested.
 */
export const channels = pgTable(
  'channels',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Lowercase and hyphenated, so it reads as `#general` wherever shown. */
    name: text('name').notNull(),
    topic: text('topic'),
    /**
     * Null once the creator's account is gone. The channel outlives them --
     * deleting a departing colleague's account must not delete the team's
     * conversation.
     */
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('channels_workspace_name_key').on(t.workspaceId, t.name)],
);

/**
 * One chat message.
 *
 * `workspaceId` is denormalised from the channel. It is redundant, and it is
 * worth it: every read is already scoped by workspace for tenancy, and
 * carrying the column means that filter is an index lookup rather than a join
 * back to `channels` on the hot path.
 *
 * Author deletion is `restrict`, matching comments: a message with no author
 * is a transcript that lies about who said what.
 */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channels.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    /** Null until edited, so "(edited)" is a fact about the row, not a guess. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /**
     * A picture posted to the room (B2): a pasted screenshot or a photo, one
     * per message, in the storage port and served to members only. The
     * code that deletes a message, its room or its workspace queues the
     * file's removal, since a cascade cannot.
     */
    imageKey: text('image_key'),
    imageContentType: text('image_content_type'),
    imageBytes: integer('image_bytes'),
    imageWidth: integer('image_width'),
    imageHeight: integer('image_height'),
    createdAt: createdAt(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(body, ''))`,
    ),
  },
  (t) => [
    /*
     * Matches the keyset order exactly -- newest first, `id` as tiebreaker --
     * so scrolling back through history is an index range scan rather than a
     * sort of the whole channel.
     */
    index('messages_channel_created_idx').on(t.channelId, t.createdAt, t.id),
    index('messages_search_idx').using('gin', t.searchVector),
    // One workspace's messages, newest first: where an issue's key is
    // looked for (its In chat list), so the scan never leaves the workspace.
    index('messages_workspace_created_idx').on(t.workspaceId, t.createdAt.desc(), t.id.desc()),
    uniqueIndex('messages_image_key_key').on(t.imageKey),
  ],
);

/**
 * A scheduled meeting.
 *
 * Robis stores the *plan*, never the call. `joinUrl` is whatever link the
 * organiser supplies -- the UI can offer to generate one, but the server
 * neither mints nor validates rooms on anybody's conferencing service. That
 * keeps a third-party dependency out of the request path, and keeps Robis
 * from implying a relationship with a provider it does not have.
 *
 * `durationMinutes` rather than an end timestamp: it is what the organiser
 * actually chooses, and an end time derived once on write would be wrong the
 * moment the start moves.
 */
export const meetings = pgTable(
  'meetings',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    agenda: text('agenda'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    joinUrl: text('join_url'),
    organizerId: uuid('organizer_id').references(() => users.id, { onDelete: 'set null' }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // "What is coming up in this workspace" is the only way this is read.
    index('meetings_workspace_starts_idx').on(t.workspaceId, t.startsAt),
  ],
);

/** What an invitee said. `pending` is the absence of an answer, stored
 * explicitly so the UI can distinguish "has not replied" from "not invited". */
export const MEETING_RESPONSES = ['pending', 'yes', 'no', 'maybe'] as const;
export type MeetingResponse = (typeof MEETING_RESPONSES)[number];

export const meetingResponseEnum = pgEnum('meeting_response', MEETING_RESPONSES);

export const meetingAttendees = pgTable(
  'meeting_attendees',
  {
    meetingId: uuid('meeting_id')
      .notNull()
      .references(() => meetings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    response: meetingResponseEnum('response').notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    // The pair is the identity: one row per person per meeting, enforced
    // rather than deduplicated after the fact.
    primaryKey({ columns: [t.meetingId, t.userId] }),
    index('meeting_attendees_user_idx').on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Watching agents (B6): what they did, how long it took, and whether people
// kept it. Nothing here holds what was sent or written: tools, outcomes,
// timings, and the ids of what was touched.

export const AGENT_STEP_OUTCOMES = ['ok', 'denied', 'error'] as const;
export const agentStepOutcome = pgEnum('agent_step_outcome', AGENT_STEP_OUTCOMES);
export const AGENT_CHANGE_OUTCOMES = ['kept', 'edited', 'reverted'] as const;
export const agentChangeOutcome = pgEnum('agent_change_outcome', AGENT_CHANGE_OUTCOMES);

/** One stretch of an agent's work: a triage run, or calls close together in time. */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `triage` for the triage agent's runs; `calls` for any other agent's. */
    source: text('source').notNull(),
    /** The run id a caller sent, if it sent one; otherwise calls are grouped by time. */
    runKey: text('run_key'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Within 30 seconds of the latest step: written at most that often, so a
     * busy agent does not rewrite its run row on every call. Its steps are
     * counted from `agent_steps`, not kept here.
     */
    lastStepAt: timestamp('last_step_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_runs_workspace_started_idx').on(t.workspaceId, t.startedAt),
    // The run a keyless call joins: the agent's latest in this workspace.
    index('agent_runs_open_idx')
      .on(t.agentId, t.workspaceId, t.lastStepAt)
      .where(sql`${t.runKey} is null`),
    // For the retention prune, which deletes runs and with them their steps.
    index('agent_runs_last_step_idx').on(t.lastStepAt),
    uniqueIndex('agent_runs_agent_workspace_run_key_key').on(t.agentId, t.workspaceId, t.runKey),
  ],
);

/** One call an agent made: the tool, the outcome, how long it took. */
export const agentSteps = pgTable(
  'agent_steps',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** An MCP tool's name, or `api:<route>` for a call made to the API directly. */
    tool: text('tool').notNull(),
    outcome: agentStepOutcome('outcome').notNull(),
    status: integer('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agent_steps_run_idx').on(t.runId, t.id),
    index('agent_steps_workspace_at_idx').on(t.workspaceId, t.at),
  ],
);

/**
 * One change an agent made, with the value before and after, so a person's
 * later edit can be told from a revert. Judged once it is seven days old:
 * still the agent's value is kept, back to the earlier one (or deleted) is
 * reverted, anything else is edited.
 */
export const agentChanges = pgTable(
  'agent_changes',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `issue` or `comment`. */
    entityType: text('entity_type').notNull(),
    /** Not a foreign key: a deleted issue is exactly what a revert can look like. */
    entityId: uuid('entity_id').notNull(),
    /** A field the agent set, or `created` for a whole new issue or comment. */
    field: text('field').notNull(),
    /** JSON values; null for a creation, which had no before. */
    before: text('before'),
    after: text('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    outcome: agentChangeOutcome('outcome'),
    judgedAt: timestamp('judged_at', { withTimezone: true }),
  },
  (t) => [
    index('agent_changes_workspace_agent_idx').on(t.workspaceId, t.agentId),
    index('agent_changes_agent_idx').on(t.agentId),
    index('agent_changes_unjudged_idx').on(t.at).where(sql`${t.judgedAt} is null`),
    // Judged means both: an outcome, and when it was decided.
    check('agent_changes_judged_whole', sql`(${t.outcome} is null) = (${t.judgedAt} is null)`),
  ],
);

export const suggestionKind = pgEnum('suggestion_kind', SUGGESTION_KINDS);
export const suggestionAction = pgEnum('suggestion_action', SUGGESTION_ACTIONS);

/**
 * What people did with a hint (B6): used it, or set it aside. No user is
 * named: this measures the hints, not the people.
 */
export const suggestionFeedback = pgTable(
  'suggestion_feedback',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: suggestionKind('kind').notNull(),
    action: suggestionAction('action').notNull(),
    /** The hint's own score, kept to compare with the offline evaluation's thresholds. */
    score: doublePrecision('score'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('suggestion_feedback_counts_idx').on(t.workspaceId, t.kind, t.action)],
);

export const labelColour = pgEnum('label_colour', LABEL_COLOURS);

/** A workspace's labels (C1): a name and a colour from the fixed palette. */
export const labels = pgTable(
  'labels',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    colour: labelColour('colour').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('labels_workspace_name_key').on(t.workspaceId, sql`lower(${t.name})`)],
);

/** Which labels an issue carries. */
export const issueLabels = pgTable(
  'issue_labels',
  {
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.labelId] }),
    index('issue_labels_label_idx').on(t.labelId),
  ],
);

/**
 * A board filter someone named and kept (C1): which statuses, priority,
 * assignee and label to show. Shared with everyone in the workspace who can
 * see the project, and kept as the validated filter, not a URL string.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** JSON of the board filter (`boardFilterSchema`). */
    filter: text('filter').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('saved_views_project_name_key').on(t.projectId, sql`lower(${t.name})`)],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Meeting = typeof meetings.$inferSelect;
export type MeetingAttendee = typeof meetingAttendees.$inferSelect;
