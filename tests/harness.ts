/**
 * Integration-test harness.
 *
 * Tests run against a real Postgres (`robis_test`), not a mock. The behaviour
 * under test here -- unique constraints, `ON DELETE CASCADE`, row locks around
 * the issue counter, transaction rollback -- is behaviour the database
 * provides, so a fake would only assert that the fake works.
 *
 * Requires the dev server to be up: `bun run db:start`.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '@robis/api/app';
import { loadEnv } from '@robis/api/env';
import { localDiskStorage } from '@robis/api/media/storage';
import type { SimilarIssue, TriageSuggestion } from '@robis/api/suggestions';
import {
  createDatabase,
  type Database,
  DEFAULT_RUNTIME_ROLE,
  DEVELOPMENT_RUNTIME_PASSWORD,
  ensureRuntimeRole,
  MAIL_JOBS,
  settleDeferredAccountEvents,
  users,
} from '@robis/database';
import { runMigrations } from '@robis/database/migrate';
import { MemoryMailer } from '@robis/mailer';
import { TERMS_VERSION } from '@robis/shared';
import { mailHandlers } from '@robis/worker/mail';
import { Runner } from '@robis/worker/runner';
import { and, eq, isNull } from 'drizzle-orm';
import postgres from 'postgres';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://robis:robis@localhost:5433/postgres';
const TEST_DB = 'robis_test';
export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://robis:robis@localhost:5433/${TEST_DB}`;

/** Where this run's uploaded pictures go; tests read files back from here. */
export const MEDIA_ROOT = mkdtempSync(join(tmpdir(), 'robis-media-'));

/** Every table that holds test state, in an order safe for `TRUNCATE CASCADE`. */
const TABLES = [
  'account_events',
  'auth_tokens',
  'audit_events',
  'audit_tombstones',
  'jobs',
  'notifications',
  'document_updates',
  'documents',
  'mutations',
  'comment_mentions',
  'comments',
  'issues',
  'projects',
  'workspace_invitations',
  'workspace_members',
  'workspaces',
  'sessions',
  'username_history',
  'users',
];

type App = ReturnType<typeof buildApp>;

/**
 * The same database as the runtime role, the account the API connects as in
 * a deployment. Every test runs through it, so a grant the application needs
 * and the role lacks fails a test rather than a deploy.
 */
function asRuntimeRole(url: string): string {
  const parsed = new URL(url);
  parsed.username = DEFAULT_RUNTIME_ROLE;
  parsed.password = DEVELOPMENT_RUNTIME_PASSWORD;
  return parsed.toString();
}

let handle: {
  app: App;
  /** The runtime role: what the app uses, and what tests should use. */
  db: Database;
  /**
   * The owner, for what only an owner may do: resetting tables between
   * tests, and the tests that tamper with the audit trail on purpose.
   */
  ownerDb: Database;
  /** Mail the worker sent, so flows that email a token can be asserted. */
  mailer: MemoryMailer;
  /** The worker's mail jobs only, so a test's other queued work stays put. */
  mailRunner: Runner;
  close: () => Promise<void>;
} | null = null;

async function ensureTestDatabase() {
  const admin = postgres(ADMIN_URL, { prepare: false, onnotice: () => {}, max: 1 });

  try {
    const [existing] = await admin`select 1 from pg_database where datname = ${TEST_DB}`;
    if (!existing) await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await admin.end();
  }
}

/**
 * What the suggestion service "returns", and what it was asked.
 *
 * The app is built once and shared, so the client cannot be swapped per
 * test. This indirection lets a test set the answer and then read back the
 * calls, which is how "a non-member never reaches the service at all" is
 * asserted rather than assumed.
 */
type SuggestionCall = { workspaceId: string; title: string };

export const suggestionCalls: SuggestionCall[] = [];

let suggestionAnswer: SimilarIssue[] = [];
let suggestionThrows = false;

/** Matches `SuggestionClient['similar']`, description included. */
async function suggestionStub(
  workspaceId: string,
  title: string,
  _description?: string | null,
): Promise<SimilarIssue[]> {
  suggestionCalls.push({ workspaceId, title });

  if (suggestionThrows) throw new Error('connection refused');
  return suggestionAnswer;
}

/** Set what the next calls return, and forget earlier calls. */
export function setSuggestions(answer: SimilarIssue[]) {
  suggestionAnswer = answer;
  suggestionThrows = false;
  suggestionCalls.length = 0;
}

/** Make the client throw, to prove a broken service cannot break the route. */
export function breakSuggestions() {
  suggestionThrows = true;
  suggestionCalls.length = 0;
}

/** What the priority model "returns", and what it was asked. */
export const triageCalls: SuggestionCall[] = [];

let triageAnswer: TriageSuggestion | null = null;
let triageThrows = false;

/** Matches `SuggestionClient['triage']`. */
async function triageStub(
  workspaceId: string,
  title: string,
  _description?: string | null,
): Promise<TriageSuggestion | null> {
  triageCalls.push({ workspaceId, title });

  if (triageThrows) throw new Error('connection refused');
  return triageAnswer;
}

export function setTriage(answer: TriageSuggestion | null) {
  triageAnswer = answer;
  triageThrows = false;
  triageCalls.length = 0;
}

export function breakTriage() {
  triageThrows = true;
  triageCalls.length = 0;
}

/** Built once and shared; each test isolates itself with `resetDatabase`. */
export async function getHarness() {
  if (handle) return handle;

  await ensureTestDatabase();

  const owner = createDatabase(TEST_URL, { max: 2 });
  await runMigrations(owner.db);
  await ensureRuntimeRole(owner.db, {
    role: DEFAULT_RUNTIME_ROLE,
    password: DEVELOPMENT_RUNTIME_PASSWORD,
  });

  const runtime = createDatabase(asRuntimeRole(TEST_URL), { max: 5 });
  const db = runtime.db;
  const close = async () => {
    await runtime.close();
    await owner.close();
  };

  const env = loadEnv({
    DATABASE_URL: TEST_URL,
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:3000',
  } as NodeJS.ProcessEnv);

  // Generous budgets: the other suites create hundreds of actors from one
  // address, and throttling them would test the limiter, not them.
  // Recorded rather than sent: the reset and verification suites read the
  // token out of the message, which proves the address received something it
  // can act on rather than asserting against a row the user never saw. The
  // API only queues mail; this is the worker's half, with the memory driver.
  const mailer = new MemoryMailer();
  const mailRunner = new Runner({
    db,
    handlers: mailHandlers({ mailer, webOrigin: env.WEB_ORIGIN }),
    kinds: MAIL_JOBS,
  });

  const app = buildApp({
    db,
    env,
    // A stub, never the real client: the suite must not depend on a Python
    // service being up, and must never reach the network. `suggestionStub`
    // below lets one test decide what it answers.
    suggestions: { similar: suggestionStub, triage: triageStub },
    // Uploads go to a throwaway directory, never into the repository.
    storage: localDiskStorage(MEDIA_ROOT),
    rateLimits: {
      authPerMinute: 100_000,
      searchPerMinute: 100_000,
      // The reset suite asserts this limit with its own small budget; the
      // other suites must not trip over it.
      passwordForgotPerHourPerAddress: 3,
    },
  });
  await app.ready();

  handle = { app, db, ownerDb: owner.db, mailer, mailRunner, close };
  return handle;
}

/** Upper bound on worker passes, so a handler that keeps failing cannot spin. */
const MAX_MAIL_TICKS = 20;

/**
 * The recorded outbox, after the worker has sent everything queued so far.
 * Cleared by `resetDatabase` along with the tables.
 */
export async function getMailer(): Promise<MemoryMailer> {
  const { mailer, mailRunner } = await getHarness();
  for (let tick = 0; tick < MAX_MAIL_TICKS; tick++) {
    if ((await mailRunner.tick()).claimed === 0) break;
  }
  return mailer;
}

export async function resetDatabase() {
  const { ownerDb: db, mailer } = await getHarness();
  // A failed sign-in is recorded after its reply; let the last test's land
  // before the tables are emptied under it.
  await settleDeferredAccountEvents();
  mailer.clear();
  // RESTART IDENTITY keeps sequences predictable across tests. The audit
  // trail refuses TRUNCATE by trigger -- that is the point of it -- so the
  // guard is lifted for this one statement, inside the same transaction, and
  // is back in place before anything else can see the table.
  await db.transaction(async (tx) => {
    await tx.execute('ALTER TABLE "audit_events" DISABLE TRIGGER "audit_events_no_truncate"');
    await tx.execute(
      'ALTER TABLE "audit_tombstones" DISABLE TRIGGER "audit_tombstones_no_truncate"',
    );
    await tx.execute('ALTER TABLE "account_events" DISABLE TRIGGER "account_events_no_truncate"');
    await tx.execute(
      `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
    await tx.execute('ALTER TABLE "audit_events" ENABLE TRIGGER "audit_events_no_truncate"');
    await tx.execute('ALTER TABLE "account_events" ENABLE TRIGGER "account_events_no_truncate"');
    await tx.execute(
      'ALTER TABLE "audit_tombstones" ENABLE TRIGGER "audit_tombstones_no_truncate"',
    );
  });
}

export async function closeHarness() {
  if (!handle) return;
  await handle.app.close();
  await handle.close();
  handle = null;
}

export type Actor = {
  id: string;
  email: string;
  name: string;
  username: string;
  /** Ready-to-send `cookie` header carrying this actor's session. */
  cookie: string;
};

let userCounter = 0;

/**
 * Register a fresh user and return their identity plus session cookie.
 *
 * Every actor picks a generated avatar straight away, as a real person must
 * before using a workspace. Pass `withAvatar: false` to test the gate.
 */
export async function createActor(
  name = `User ${++userCounter}`,
  { withAvatar = true }: { withAvatar?: boolean } = {},
): Promise<Actor> {
  const { app } = await getHarness();
  const email = `user${userCounter}-${Date.now()}@robis.test`;
  // Unique per run, like the email, and always a valid username.
  const username = `user${userCounter}_${Date.now()}`;

  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email,
      name,
      username,
      password: 'correct-horse-battery-staple',
      ageConfirmed: true,
      termsVersion: TERMS_VERSION,
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to register actor: ${response.statusCode} ${response.body}`);
  }

  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('Register did not set a session cookie');

  const user = response.json().user as { id: string };

  const actor = { id: user.id, email, name, username, cookie: raw.split(';')[0]! };

  if (withAvatar) {
    const avatar = await app.inject({
      method: 'PUT',
      url: '/auth/me/avatar/generated',
      headers: { cookie: actor.cookie },
      payload: { seed: `actor-${userCounter}` },
    });
    if (avatar.statusCode !== 200) {
      throw new Error(`Failed to set actor avatar: ${avatar.statusCode} ${avatar.body}`);
    }
  }

  return actor;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload?: unknown;
  actor?: Actor;
  headers?: Record<string, string>;
};

/** Thin wrapper over `app.inject` that attaches the actor's cookie. */
export async function request(url: string, options: RequestOptions = {}) {
  const { app } = await getHarness();

  return app.inject({
    method: options.method ?? 'GET',
    url,
    payload: options.payload as never,
    headers: {
      ...(options.actor ? { cookie: options.actor.cookie } : {}),
      ...options.headers,
    },
  });
}

/** Create a workspace owned by `actor`. */
export async function createWorkspace(actor: Actor, name = 'Engineering') {
  const response = await request('/workspaces', { method: 'POST', payload: { name }, actor });
  if (response.statusCode !== 201) {
    throw new Error(`Failed to create workspace: ${response.statusCode} ${response.body}`);
  }
  return response.json().workspace as { id: string; slug: string; name: string };
}

/**
 * Add `user` to `workspaceId` with the given role, acting as `actor`: the
 * whole real path, so every suite exercises it. `actor` invites, the
 * invited person's address is confirmed (accepting needs it), and they
 * accept.
 */
export async function addMember(
  actor: Actor,
  workspaceId: string,
  user: Actor,
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
) {
  const response = await request(`/workspaces/${workspaceId}/members`, {
    method: 'POST',
    payload: { email: user.email, role },
    actor,
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to invite member: ${response.statusCode} ${response.body}`);
  }

  const { ownerDb } = await getHarness();
  await ownerDb
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, user.id), isNull(users.emailVerifiedAt)));

  const invitationId = response.json().invitation.id as string;
  const accepted = await request(`/invitations/${invitationId}/accept`, {
    method: 'POST',
    actor: user,
  });
  if (accepted.statusCode !== 200) {
    throw new Error(`Failed to accept invitation: ${accepted.statusCode} ${accepted.body}`);
  }
}

export async function createProject(actor: Actor, workspaceId: string, name = 'Web App') {
  const response = await request(`/workspaces/${workspaceId}/projects`, {
    method: 'POST',
    payload: { name },
    actor,
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to create project: ${response.statusCode} ${response.body}`);
  }
  return response.json().project as { id: string; key: string };
}
