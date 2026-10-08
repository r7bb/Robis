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
import { buildApp } from '@robis/api/app';
import { loadEnv } from '@robis/api/env';
import type { SimilarIssue } from '@robis/api/suggestions';
import { createDatabase, type Database } from '@robis/database';
import { runMigrations } from '@robis/database/migrate';
import { MemoryMailer } from '@robis/mailer';
import postgres from 'postgres';

const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgres://robis:robis@localhost:5433/postgres';
const TEST_DB = 'robis_test';
export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://robis:robis@localhost:5433/${TEST_DB}`;

/** Every table that holds test state, in an order safe for `TRUNCATE CASCADE`. */
const TABLES = [
  'auth_tokens',
  'audit_events',
  'jobs',
  'notifications',
  'document_updates',
  'documents',
  'mutations',
  'comments',
  'issues',
  'projects',
  'workspace_members',
  'workspaces',
  'sessions',
  'users',
];

type App = ReturnType<typeof buildApp>;

let handle: {
  app: App;
  db: Database;
  /** Mail the app tried to send, so flows that email a token can be asserted. */
  mailer: MemoryMailer;
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

/** Built once and shared; each test isolates itself with `resetDatabase`. */
export async function getHarness() {
  if (handle) return handle;

  await ensureTestDatabase();

  const { db, close } = createDatabase(TEST_URL, { max: 5 });
  await runMigrations(db);

  const env = loadEnv({
    DATABASE_URL: TEST_URL,
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:3000',
  } as NodeJS.ProcessEnv);

  // Generous budgets: the other suites create hundreds of actors from one
  // address, and throttling them would test the limiter, not them.
  // Recorded rather than sent: the reset and verification suites read the
  // token out of the message, which proves the address received something it
  // can act on rather than asserting against a row the user never saw.
  const mailer = new MemoryMailer();

  const app = buildApp({
    db,
    env,
    mailer,
    // A stub, never the real client: the suite must not depend on a Python
    // service being up, and must never reach the network. `suggestionStub`
    // below lets one test decide what it answers.
    suggestions: { similar: suggestionStub },
    rateLimits: {
      authPerMinute: 100_000,
      searchPerMinute: 100_000,
      // The reset suite asserts this limit with its own small budget; the
      // other suites must not trip over it.
      passwordForgotPerHourPerAddress: 3,
    },
  });
  await app.ready();

  handle = { app, db, mailer, close };
  return handle;
}

/** The recorded outbox. Cleared by `resetDatabase` along with the tables. */
export async function getMailer(): Promise<MemoryMailer> {
  return (await getHarness()).mailer;
}

export async function resetDatabase() {
  const { db, mailer } = await getHarness();
  mailer.clear();
  // One statement so it is a single round trip and a single implicit
  // transaction; RESTART IDENTITY keeps sequences predictable across tests.
  await db.execute(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
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
  /** Ready-to-send `cookie` header carrying this actor's session. */
  cookie: string;
};

let userCounter = 0;

/** Register a fresh user and return their identity plus session cookie. */
export async function createActor(name = `User ${++userCounter}`): Promise<Actor> {
  const { app } = await getHarness();
  const email = `user${userCounter}-${Date.now()}@robis.test`;

  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, name, password: 'correct-horse-battery-staple' },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Failed to register actor: ${response.statusCode} ${response.body}`);
  }

  const setCookie = response.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) throw new Error('Register did not set a session cookie');

  const user = response.json().user as { id: string };

  return { id: user.id, email, name, cookie: raw.split(';')[0]! };
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

/** Add `user` to `workspaceId` with the given role, acting as `actor`. */
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
    throw new Error(`Failed to add member: ${response.statusCode} ${response.body}`);
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
