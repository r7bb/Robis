import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { accountEvents, personalAccessTokens } from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  type Actor,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Personal access tokens (C7). Done when: a token without the write scope
 * gets 403 on a write, while a write token may; a token is shown once,
 * works on workspace routes only (never on account routes, so it cannot
 * make another), records when it was used, and stops at once when revoked
 * or expired.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function makeToken(actor: Actor, write: boolean, lifetimeDays: number | null = null) {
  const made = await request('/me/tokens', {
    method: 'POST',
    actor,
    payload: {
      name: write ? 'Deploy bot' : 'Read only',
      write,
      lifetimeDays,
      password: ACTOR_PASSWORD,
    },
  });
  expect(made.statusCode).toBe(201);
  return made.json() as { token: { id: string; scopes: string[] }; secret: string };
}

const withToken = (secret: string) => ({ authorization: `Bearer ${secret}` });

describe('a personal access token', () => {
  test('without the write scope reads but gets 403 on a write; a write token may write', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const issues = `/workspaces/${workspace.id}/projects/${project.id}/issues`;

    const reader = await makeToken(owner, false);
    expect(reader.secret).toMatch(/^rbp_[A-Za-z0-9_-]{43}$/);
    expect(reader.token.scopes).toEqual(['read']);
    const listed = await request('/me/tokens', { actor: owner });
    expect(JSON.stringify(listed.json())).not.toContain(reader.secret);

    expect((await request(issues, { headers: withToken(reader.secret) })).statusCode).toBe(200);
    const refused = await request(issues, {
      method: 'POST',
      headers: withToken(reader.secret),
      payload: { title: 'Not allowed' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toContain('only read');

    const writer = await makeToken(owner, true);
    const filed = await request(issues, {
      method: 'POST',
      headers: withToken(writer.secret),
      payload: { title: 'Filed by a token' },
    });
    expect(filed.statusCode).toBe(201);
    // Done as its owner, who the trail names.
    expect(filed.json().issue.createdBy).toBe(owner.id);

    const { ownerDb } = await getHarness();
    const [used] = await ownerDb
      .select()
      .from(personalAccessTokens)
      .where(eq(personalAccessTokens.id, reader.token.id));
    expect(used!.lastUsedAt).not.toBeNull();
  });

  test('never reaches account routes, nor a workspace its owner is not in', async () => {
    const owner = await createActor('Owner');
    const writer = await makeToken(owner, true);
    expect((await request('/me/tokens', { headers: withToken(writer.secret) })).statusCode).toBe(
      401,
    );
    const another = await request('/me/tokens', {
      method: 'POST',
      headers: withToken(writer.secret),
      payload: { name: 'Sneaky', write: true, lifetimeDays: null, password: ACTOR_PASSWORD },
    });
    expect(another.statusCode).toBe(401);
    expect((await request('/workspaces', { headers: withToken(writer.secret) })).statusCode).toBe(
      401,
    );

    const stranger = await createActor('Stranger');
    const theirs = await createWorkspace(stranger, 'Theirs');
    const peek = await request(`/workspaces/${theirs.id}`, { headers: withToken(writer.secret) });
    expect(peek.statusCode).toBe(404);
  });

  test('stops at once when revoked or expired, and both are in the account trail', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const path = `/workspaces/${workspace.id}`;
    const token = await makeToken(owner, false, 30);
    expect((await request(path, { headers: withToken(token.secret) })).statusCode).toBe(200);

    const revoked = await request(`/me/tokens/${token.token.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(revoked.statusCode).toBe(204);
    expect((await request(path, { headers: withToken(token.secret) })).statusCode).toBe(401);

    const old = await makeToken(owner, false, 30);
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(personalAccessTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(personalAccessTokens.id, old.token.id));
    expect((await request(path, { headers: withToken(old.secret) })).statusCode).toBe(401);

    const trail = await ownerDb
      .select({ eventType: accountEvents.eventType })
      .from(accountEvents)
      .where(eq(accountEvents.userId, owner.id));
    const types = trail.map((e) => e.eventType);
    expect(types.filter((t) => t === 'auth.token_created')).toHaveLength(2);
    expect(types).toContain('auth.token_revoked');
  });
});

describe('a password change', () => {
  test('revokes every token, and a token needs the password to be made', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const wrong = await request('/me/tokens', {
      method: 'POST',
      actor: owner,
      payload: { name: 'Guess', write: true, lifetimeDays: null, password: 'not-it' },
    });
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    const token = await makeToken(owner, true);
    const path = `/workspaces/${workspace.id}`;
    expect((await request(path, { headers: withToken(token.secret) })).statusCode).toBe(200);
    const { ownerDb } = await getHarness();
    const { revokeAllSessions } = await import('@robis/auth');
    await revokeAllSessions(ownerDb, owner.id);
    expect((await request(path, { headers: withToken(token.secret) })).statusCode).toBe(401);
  });
});
