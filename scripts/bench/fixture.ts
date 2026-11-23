/** What the load and soak harnesses share (E2): accounts, a workspace, and waiting for a service. */
import { createSession, hashPassword, SESSION_COOKIE } from '@robis/auth';
import { type Database, projects, users, workspaceMembers, workspaces } from '@robis/database';
import { slugify, TERMS_VERSION } from '@robis/shared';
import { eq, inArray } from 'drizzle-orm';

const FIXTURE_CONSENT = {
  ageConfirmedAt: new Date(),
  termsVersion: TERMS_VERSION,
  termsAcceptedAt: new Date(),
  usernameConfirmedAt: new Date(),
};

export function portIsFree(port: number): boolean {
  try {
    const server = Bun.listen({ hostname: '127.0.0.1', port, socket: { data() {} } });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

export async function waitForHealth(url: string, name: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(100);
  }

  throw new Error(`${name} did not become healthy within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

export type Actor = { userId: string; token: string; cookie: string };

export type Fixture = {
  workspaceId: string;
  projectIds: string[];
  actors: Actor[];
};

/**
 * Build the workspace under test.
 *
 * Accounts and sessions are written straight to the database rather than
 * created through `/auth/register`. Registration is deliberately expensive --
 * Argon2id, by design -- and rate limited per address, so driving it here
 * would measure the password hash and then get throttled. Setup is not the
 * thing under test.
 */
export async function setupFixture(
  db: Database,
  count: number,
  projectCount = 4,
): Promise<Fixture> {
  const runId = crypto.randomUUID().slice(0, 8);
  const name = `Load Test ${runId}`;

  // One hash reused for every account: the cost is per-password, not per-user,
  // and no one signs in to these.
  const passwordHash = await hashPassword(`load-${runId}`);

  const created = await db
    .insert(users)
    .values(
      Array.from({ length: count }, (_, i) => ({
        email: `loadtest-${runId}-${i}@robis.invalid`,
        name: `Load ${i}`,
        username: `loadtest_${runId}_${i}`,
        passwordHash,
        // Fixture people, not real ones: marked as having agreed and chosen
        // their names, so a fresh seed does not ask them on every sign-in.
        ...FIXTURE_CONSENT,
        // And given a picture: workspaces are closed to an account without
        // one, so a harness without it measures nothing but refusals.
        avatarKind: 'generated' as const,
        avatarRef: `load-${runId}-${i}`,
      })),
    )
    .returning({ id: users.id });

  const ownerId = created[0]!.id;

  const [workspace] = await db
    .insert(workspaces)
    .values({ name, slug: slugify(name), createdBy: ownerId })
    .returning({ id: workspaces.id });

  await db.insert(workspaceMembers).values(
    created.map((user, i) => ({
      workspaceId: workspace!.id,
      userId: user.id,
      role: i === 0 ? ('OWNER' as const) : ('MEMBER' as const),
    })),
  );

  const createdProjects = await db
    .insert(projects)
    .values(
      Array.from({ length: projectCount }, (_, i) => ({
        workspaceId: workspace!.id,
        key: `LT${i}`,
        name: `Load project ${i}`,
        createdBy: ownerId,
      })),
    )
    .returning({ id: projects.id });

  const actors: Actor[] = [];
  for (const user of created) {
    const { token } = await createSession(db, user.id, 'loadtest');
    actors.push({ userId: user.id, token, cookie: `${SESSION_COOKIE}=${token}` });
  }

  return {
    workspaceId: workspace!.id,
    projectIds: createdProjects.map((p) => p.id),
    actors,
  };
}

/** Workspaces cascade to projects and issues; accounts go after, being referenced. */
export async function teardownFixture(db: Database, fixture: Fixture) {
  await db.delete(workspaces).where(eq(workspaces.id, fixture.workspaceId));
  await db.delete(users).where(
    inArray(
      users.id,
      fixture.actors.map((a) => a.userId),
    ),
  );
}
