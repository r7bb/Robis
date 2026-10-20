import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { users } from '@robis/database';
import { TERMS_VERSION } from '@robis/shared';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * What someone agreed to, and when: the age confirmation and the terms
 * version are stored at sign-up, asked for again when the terms change,
 * and the server holds the line, as it does for the picture. Accounts
 * from before usernames are asked once to confirm theirs.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function me(actor: Actor) {
  return (await request('/auth/me', { actor })).json().user;
}

/** As if this account had agreed to an older version of the terms. */
async function agreedToOldTerms(actor: Actor) {
  const { db } = await getHarness();
  await db.update(users).set({ termsVersion: '2000-01-01' }).where(eq(users.id, actor.id));
}

function consent(actor: Actor, payload: unknown) {
  return request('/auth/me/consent', { method: 'POST', actor, payload });
}

describe('consent at sign-up', () => {
  test('is stored with the time and the terms version agreed to', async () => {
    const actor = await createActor();
    const { db } = await getHarness();
    const [row] = await db
      .select({
        ageConfirmedAt: users.ageConfirmedAt,
        termsVersion: users.termsVersion,
        termsAcceptedAt: users.termsAcceptedAt,
      })
      .from(users)
      .where(eq(users.id, actor.id));

    expect(row?.termsVersion).toBe(TERMS_VERSION);
    expect(row?.ageConfirmedAt).toBeInstanceOf(Date);
    expect(row?.termsAcceptedAt).toBeInstanceOf(Date);
    expect((await me(actor)).consent).toEqual({
      needed: false,
      termsVersion: TERMS_VERSION,
      current: TERMS_VERSION,
    });
  });

  test('is in your own account history from the start', async () => {
    const actor = await createActor();
    const history = (await request('/auth/me/events', { actor })).json();
    const agreed = history.events.filter(
      (event: { type: string }) => event.type === 'auth.terms_accepted',
    );
    expect(agreed.map((event: { payload: unknown }) => event.payload)).toEqual([
      { termsVersion: TERMS_VERSION },
    ]);
  });

  test('without saying which terms the page showed, is not counted as agreeing', async () => {
    const stamp = Date.now();
    const response = await request('/auth/register', {
      method: 'POST',
      payload: {
        email: `silent-${stamp}@robis.test`,
        name: 'Silent',
        username: `silent_${stamp}`,
        password: 'correct-horse-battery-staple',
        ageConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(201);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    const self = await request('/auth/me', { headers: { cookie } });
    expect(self.json().user.consent.needed).toBe(true);
  });

  test('to terms the page no longer shows is refused', async () => {
    const response = await request('/auth/register', {
      method: 'POST',
      payload: {
        email: `stale-${Date.now()}@robis.test`,
        name: 'Stale',
        username: `stale_${Date.now()}`,
        password: 'correct-horse-battery-staple',
        ageConfirmed: true,
        termsVersion: '2000-01-01',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('terms_changed');
  });
});

describe('when the terms change', () => {
  test('the account is asked again, and the server holds the line until it answers', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    await agreedToOldTerms(owner);

    expect((await me(owner)).consent.needed).toBe(true);
    const blocked = await request(`/workspaces/${workspace.id}/projects`, { actor: owner });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe('terms_required');

    // The account itself still works: you can read and answer the question.
    expect((await request('/auth/me', { actor: owner })).statusCode).toBe(200);

    const answered = await consent(owner, { termsVersion: TERMS_VERSION, ageConfirmed: true });
    expect(answered.statusCode).toBe(200);
    expect((await me(owner)).consent.needed).toBe(false);
    expect(
      (await request(`/workspaces/${workspace.id}/projects`, { actor: owner })).statusCode,
    ).toBe(200);
  });

  test('agreeing is recorded in your own account history', async () => {
    const actor = await createActor();
    await agreedToOldTerms(actor);
    await consent(actor, { termsVersion: TERMS_VERSION, ageConfirmed: true });
    const history = (await request('/auth/me/events', { actor })).json();
    const agreed = history.events.find(
      (event: { type: string }) => event.type === 'auth.terms_accepted',
    );
    expect(agreed?.payload).toEqual({ termsVersion: TERMS_VERSION });
  });

  test('agreeing again changes nothing: the first answer and its time stand', async () => {
    const actor = await createActor();
    const { db } = await getHarness();
    const [before] = await db
      .select({ at: users.termsAcceptedAt })
      .from(users)
      .where(eq(users.id, actor.id));
    await consent(actor, { termsVersion: TERMS_VERSION, ageConfirmed: true });
    await request('/auth/me/username/confirm', { method: 'POST', actor });

    const [after] = await db
      .select({ at: users.termsAcceptedAt })
      .from(users)
      .where(eq(users.id, actor.id));
    expect(after?.at?.getTime()).toBe(before?.at?.getTime());
    const types = (await request('/auth/me/events', { actor }))
      .json()
      .events.map((event: { type: string }) => event.type);
    expect(types.filter((type: string) => type === 'auth.terms_accepted')).toHaveLength(1);
    expect(types).not.toContain('auth.username_confirmed');
  });

  test('joining a workspace waits for an answer too', async () => {
    const owner = await createActor('Owner');
    const invitee = await createActor('Invitee');
    const workspace = await createWorkspace(owner);
    const { db } = await getHarness();
    await db
      .update(users)
      .set({ emailVerifiedAt: new Date(), termsVersion: '2000-01-01' })
      .where(eq(users.id, invitee.id));
    const invited = await request(`/workspaces/${workspace.id}/members`, {
      method: 'POST',
      actor: owner,
      payload: { username: invitee.username, role: 'MEMBER' },
    });
    const accept = await request(`/invitations/${invited.json().invitation.id}/accept`, {
      method: 'POST',
      actor: invitee,
    });
    expect(accept.statusCode).toBe(403);
    expect(accept.json().error).toBe('terms_required');
  });

  test('agreeing to a version that is not the current one is refused', async () => {
    const actor = await createActor();
    await agreedToOldTerms(actor);
    const stale = await consent(actor, { termsVersion: '2000-01-01', ageConfirmed: true });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('terms_changed');
    const unconfirmed = await consent(actor, { termsVersion: TERMS_VERSION });
    expect(unconfirmed.statusCode).toBe(400);
  });

  test('leaving a workspace never needs an answer', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');
    await agreedToOldTerms(member);

    const left = await request(`/workspaces/${workspace.id}/members/me`, {
      method: 'DELETE',
      actor: member,
    });
    expect(left.statusCode).toBe(204);
  });
});

describe('accounts from before usernames', () => {
  test('are asked once to confirm theirs, and keeping it counts', async () => {
    const actor = await createActor();
    expect((await me(actor)).usernameConfirmed).toBe(true);

    const { db } = await getHarness();
    await db.update(users).set({ usernameConfirmedAt: null }).where(eq(users.id, actor.id));
    expect((await me(actor)).usernameConfirmed).toBe(false);

    const kept = await request('/auth/me/username/confirm', { method: 'POST', actor });
    expect(kept.statusCode).toBe(200);
    expect((await me(actor)).usernameConfirmed).toBe(true);
  });

  test('changing the name instead counts as confirming it', async () => {
    const actor = await createActor();
    const { db } = await getHarness();
    await db.update(users).set({ usernameConfirmedAt: null }).where(eq(users.id, actor.id));
    await request('/auth/me', {
      method: 'PATCH',
      actor,
      payload: { username: `chosen_${Date.now()}` },
    });
    expect((await me(actor)).usernameConfirmed).toBe(true);
  });
});
