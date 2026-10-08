import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { SESSION_COOKIE } from '@robis/auth';
import {
  type Actor,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Account self-service: profile, password, sessions.
 *
 * The interesting cases are all about what a *stolen session* can and cannot
 * do. Being signed in is not the same as proving you are the account holder,
 * and the tests below are mostly that distinction.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

/** The harness signs actors in; this is the password it uses. */
const PASSWORD = 'correct-horse-battery-staple';

/** A second, independent session for the same account. */
async function secondSession(actor: Actor): Promise<string> {
  const response = await request('/auth/login', {
    method: 'POST',
    payload: { email: actor.email, password: PASSWORD },
  });

  const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
  if (!cookie) throw new Error('login returned no session cookie');
  return cookie.value;
}

const meWith = (token: string) =>
  request('/auth/me', { headers: { cookie: `${SESSION_COOKIE}=${token}` } });

/** The harness hands out a ready-made cookie header; this is the token in it. */
const tokenOf = (actor: Actor): string => actor.cookie.split('=')[1]!;

describe('profile', () => {
  test('changes the display name', async () => {
    const actor = await createActor('Old Name');

    const response = await request('/auth/me', {
      method: 'PATCH',
      payload: { name: 'New Name' },
      actor,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().user.name).toBe('New Name');
    expect((await request('/auth/me', { actor })).json().user.name).toBe('New Name');
  });

  test('a blank name is rejected', async () => {
    const actor = await createActor('Named');

    expect(
      (await request('/auth/me', { method: 'PATCH', payload: { name: '   ' }, actor })).statusCode,
    ).toBe(400);
  });

  test('signed-out callers cannot change a name', async () => {
    expect(
      (await request('/auth/me', { method: 'PATCH', payload: { name: 'X' } })).statusCode,
    ).toBe(401);
  });

  /** The rename shows up wherever the account is displayed, not just on /me. */
  test('the new name appears in workspace membership', async () => {
    const actor = await createActor('Before');
    const workspace = await createWorkspace(actor);

    await request('/auth/me', { method: 'PATCH', payload: { name: 'After' }, actor });

    const members = (await request(`/workspaces/${workspace.id}/members`, { actor })).json();
    expect(members.members[0].name).toBe('After');
  });
});

describe('changing a password', () => {
  test('requires the current password', async () => {
    const actor = await createActor('Holder');

    const response = await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' },
      actor,
    });

    // Being signed in is not proof of being the account holder: a stolen
    // session must not be upgradeable into account takeover.
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_password');
  });

  test('the new password works and the old one stops working', async () => {
    const actor = await createActor('Holder');

    const changed = await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' },
      actor,
    });
    expect(changed.statusCode).toBe(200);

    const withOld = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: PASSWORD },
    });
    expect(withOld.statusCode).toBe(401);

    const withNew = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: 'a-brand-new-password' },
    });
    expect(withNew.statusCode).toBe(200);
  });

  test('a short password is refused', async () => {
    const actor = await createActor('Holder');

    const response = await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
      actor,
    });

    expect(response.statusCode).toBe(400);
  });

  /** Revoking every session for a no-op change would be a rude surprise. */
  test('reusing the same password is refused', async () => {
    const actor = await createActor('Holder');

    const response = await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: PASSWORD },
      actor,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('same_password');
  });

  /**
   * The point of the whole exercise. Someone changing their password because
   * a laptop was stolen expects the laptop to be signed out.
   */
  test('every other session is revoked', async () => {
    const actor = await createActor('Holder');
    const other = await secondSession(actor);

    expect((await meWith(other)).statusCode).toBe(200);

    await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' },
      actor,
    });

    expect((await meWith(other)).statusCode).toBe(401);
  });

  test('the caller gets a fresh session rather than being signed out', async () => {
    const actor = await createActor('Holder');

    const response = await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' },
      actor,
    });

    // The old token was revoked along with the rest, so a replacement cookie
    // has to come back or the user is signed out by their own password change.
    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect((await meWith(cookie!.value)).statusCode).toBe(200);
  });

  test('the old token is dead even though a new one was issued', async () => {
    const actor = await createActor('Holder');
    const before = tokenOf(actor);

    await request('/auth/password', {
      method: 'POST',
      payload: { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' },
      actor,
    });

    // If the current token were spared and it was the leaked one, the change
    // would have accomplished nothing.
    expect((await meWith(before)).statusCode).toBe(401);
  });
});

describe('listing sessions', () => {
  test('shows one entry per signed-in browser', async () => {
    const actor = await createActor('Holder');
    await secondSession(actor);

    const response = await request('/auth/sessions', { actor });
    expect(response.statusCode).toBe(200);
    expect(response.json().sessions).toHaveLength(2);
  });

  test('marks exactly one session as the current one', async () => {
    const actor = await createActor('Holder');
    await secondSession(actor);

    const sessions = (await request('/auth/sessions', { actor })).json().sessions;
    expect(sessions.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  /** A device list that hands out credentials would defeat its own purpose. */
  test('never returns a token or its hash', async () => {
    const actor = await createActor('Holder');

    const body = (await request('/auth/sessions', { actor })).body;
    expect(body).not.toContain('tokenHash');
    expect(body).not.toContain(tokenOf(actor));
  });

  test('only ever shows your own sessions', async () => {
    const actor = await createActor('Holder');
    const stranger = await createActor('Stranger');
    await secondSession(stranger);

    expect((await request('/auth/sessions', { actor })).json().sessions).toHaveLength(1);
  });

  test('signed-out callers get 401', async () => {
    expect((await request('/auth/sessions')).statusCode).toBe(401);
  });
});

describe('revoking other sessions', () => {
  test('signs out everywhere else but keeps this session', async () => {
    const actor = await createActor('Holder');
    const other = await secondSession(actor);

    const response = await request('/auth/sessions', { method: 'DELETE', actor });
    expect(response.json().revoked).toBe(1);

    expect((await meWith(other)).statusCode).toBe(401);
    // Still signed in here.
    expect((await request('/auth/me', { actor })).statusCode).toBe(200);
  });

  test('revoking with no other sessions is a no-op rather than an error', async () => {
    const actor = await createActor('Holder');

    const response = await request('/auth/sessions', { method: 'DELETE', actor });
    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBe(0);
    expect((await request('/auth/me', { actor })).statusCode).toBe(200);
  });

  test('cannot reach another account', async () => {
    const actor = await createActor('Holder');
    const stranger = await createActor('Stranger');
    const strangerOther = await secondSession(stranger);

    await request('/auth/sessions', { method: 'DELETE', actor });

    // The stranger's sessions are untouched.
    expect((await meWith(strangerOther)).statusCode).toBe(200);
  });
});

describe('the audit trail', () => {
  /**
   * These payloads record the values as they were, so an entry stays truthful
   * after the thing it describes is renamed or deleted.
   */
  test('names the member whose role changed', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const target = await createActor('Target');

    await request(`/workspaces/${workspace.id}/members`, {
      method: 'POST',
      payload: { email: target.email, role: 'MEMBER' },
      actor: owner,
    });

    await request(`/workspaces/${workspace.id}/members/${target.id}`, {
      method: 'PATCH',
      payload: { role: 'ADMIN' },
      actor: owner,
    });

    const { events } = (
      await request(`/workspaces/${workspace.id}/activity`, {
        actor: owner,
      })
    ).json();

    const changed = events.find(
      (e: { eventType: string }) => e.eventType === 'member.role_changed',
    );

    // "changed a member from member to admin" records that something happened
    // and not what; the email is what makes the row an audit entry.
    expect(changed.payload.email).toBe(target.email);
    expect(changed.payload.from).toBe('MEMBER');
    expect(changed.payload.to).toBe('ADMIN');
  });

  test('names the issue whose status changed, and survives its deletion', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);

    const created = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        payload: { title: 'Will be deleted' },
        actor: owner,
      })
    ).json().issue;

    await request(`/workspaces/${workspace.id}/issues/${created.id}`, {
      method: 'PATCH',
      payload: { status: 'DONE' },
      actor: owner,
    });

    await request(`/workspaces/${workspace.id}/issues/${created.id}`, {
      method: 'DELETE',
      actor: owner,
    });

    const { events } = (
      await request(`/workspaces/${workspace.id}/activity`, {
        actor: owner,
      })
    ).json();

    const moved = events.find((e: { eventType: string }) => e.eventType === 'issue.status_changed');

    // The issue is gone, so a join would have produced nothing here.
    expect(moved.payload.key).toBe(created.key);
    expect(moved.payload.to).toBe('DONE');
  });

  test('carries the actor name for display', async () => {
    const owner = await createActor('Ada Lovelace');
    const workspace = await createWorkspace(owner);

    const { events } = (
      await request(`/workspaces/${workspace.id}/activity`, {
        actor: owner,
      })
    ).json();

    expect(events[0].actorName).toBe('Ada Lovelace');
  });
});

/**
 * Whitespace-only input.
 *
 * Zod applies `.trim()` as a transform *after* the length checks, so
 * `z.string().min(1).trim()` accepts "   " and then stores "". Every text
 * schema in the app had that ordering. These are the user-visible
 * consequences, so they fail if the order is ever put back.
 */
describe('blank input is not a value', () => {
  test('a whitespace-only display name is refused', async () => {
    const actor = await createActor('Named');

    const response = await request('/auth/me', {
      method: 'PATCH',
      payload: { name: '   ' },
      actor,
    });

    expect(response.statusCode).toBe(400);
    // And the real name is untouched.
    expect((await request('/auth/me', { actor })).json().user.name).toBe('Named');
  });

  test('a whitespace-only issue title is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);

    const response = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      payload: { title: '  \t ' },
      actor: owner,
    });

    expect(response.statusCode).toBe(400);
  });

  test('a whitespace-only comment is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);

    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        payload: { title: 'Real title' },
        actor: owner,
      })
    ).json().issue;

    const response = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: '\n  \n' },
      actor: owner,
    });

    expect(response.statusCode).toBe(400);
  });

  test('a whitespace-only workspace name is refused', async () => {
    const actor = await createActor('Owner');

    const response = await request('/workspaces', {
      method: 'POST',
      payload: { name: ' ' },
      actor,
    });

    expect(response.statusCode).toBe(400);
  });

  /** Trimming still happens; it just no longer hides an empty value. */
  test('surrounding whitespace is still trimmed off a real value', async () => {
    const actor = await createActor('Before');

    const response = await request('/auth/me', {
      method: 'PATCH',
      payload: { name: '  Ada Lovelace  ' },
      actor,
    });

    expect(response.json().user.name).toBe('Ada Lovelace');
  });
});
