import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { auditEvents } from '@robis/database';
import { usernameProblem } from '@robis/shared';
import { eq } from 'drizzle-orm';
import {
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

beforeEach(resetDatabase);
afterAll(closeHarness);

const PASSWORD = 'correct-horse-battery-staple';

function register(payload: Record<string, unknown>) {
  return request('/auth/register', {
    method: 'POST',
    payload: { name: 'Ada', password: PASSWORD, ageConfirmed: true, ...payload },
  });
}

describe('the username rule', () => {
  test('accepts ordinary handles', () => {
    for (const ok of ['ada', 'ada.lovelace', 'grace_h', 'r2d2', 'a'.repeat(30)]) {
      expect(usernameProblem(ok)).toBeNull();
    }
  });

  test('refuses what would not read as one handle', () => {
    expect(usernameProblem('ab')).toBe('length');
    expect(usernameProblem('a'.repeat(31))).toBe('length');
    for (const bad of ['Ada', 'ada-l', '.ada', 'ada.', 'ada..l', 'ad a', 'ada@x']) {
      expect(usernameProblem(bad)).toBe('characters');
    }
    expect(usernameProblem('admin')).toBe('reserved');
    expect(usernameProblem('everyone')).toBe('reserved');
  });
});

describe('signing up with a username', () => {
  test('the username is stored lowercased and returned', async () => {
    const response = await register({ email: 'ada@robis.test', username: ' Ada.Lovelace ' });

    expect(response.statusCode).toBe(201);
    expect(response.json().user.username).toBe('ada.lovelace');
  });

  test('a taken username is a 409 that says which field', async () => {
    await register({ email: 'ada@robis.test', username: 'ada' });
    const second = await register({ email: 'other@robis.test', username: 'ADA' });

    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('username_taken');
  });

  test('a username is required, and must be valid', async () => {
    expect((await register({ email: 'ada@robis.test' })).statusCode).toBe(400);
    expect((await register({ email: 'ada@robis.test', username: 'admin' })).statusCode).toBe(400);
    expect((await register({ email: 'ada@robis.test', username: 'a-b' })).statusCode).toBe(400);
  });

  test('the age confirmation is required, as true, not merely present', async () => {
    const missing = await request('/auth/register', {
      method: 'POST',
      payload: { email: 'ada@robis.test', name: 'Ada', username: 'ada', password: PASSWORD },
    });
    const declined = await register({
      email: 'ada@robis.test',
      username: 'ada',
      ageConfirmed: false,
    });

    expect(missing.statusCode).toBe(400);
    expect(declined.statusCode).toBe(400);
  });
});

describe('checking availability', () => {
  test('says why a name cannot be had', async () => {
    const owner = await createActor('Owner');

    const check = async (username: string) =>
      (await request(`/auth/username-available?username=${encodeURIComponent(username)}`)).json();

    expect(await check('x')).toMatchObject({ available: false, reason: 'length' });
    expect(await check('root')).toMatchObject({ available: false, reason: 'reserved' });
    expect(await check(owner.username)).toMatchObject({ available: false, reason: 'taken' });
    expect(await check('free_name')).toMatchObject({ available: true, reason: null });
  });

  test('a repeated parameter is an answer, not a crash', async () => {
    const response = await request('/auth/username-available?username=a&username=b');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ available: false });
  });

  test('your own current name is available to you', async () => {
    const owner = await createActor('Owner');
    const response = await request(`/auth/username-available?username=${owner.username}`, {
      actor: owner,
    });

    expect(response.json()).toMatchObject({ available: true });
  });
});

describe('changing a username', () => {
  test('it changes everywhere the session is read', async () => {
    const actor = await createActor('Ada');

    const changed = await request('/auth/me', {
      method: 'PATCH',
      actor,
      payload: { username: 'ada_new' },
    });
    expect(changed.statusCode).toBe(200);

    const me = await request('/auth/me', { actor });
    expect(me.json().user.username).toBe('ada_new');
  });

  test("someone else's name is refused", async () => {
    const ada = await createActor('Ada');
    const grace = await createActor('Grace');

    const response = await request('/auth/me', {
      method: 'PATCH',
      actor: grace,
      payload: { username: ada.username },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('username_taken');
  });
});

describe('usernames inside a workspace', () => {
  test('an admin can add someone by username', async () => {
    const owner = await createActor('Owner');
    const invitee = await createActor('Invitee');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/members`, {
      method: 'POST',
      actor: owner,
      payload: { username: invitee.username, role: 'MEMBER' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().member.userId).toBe(invitee.id);
  });

  test('adding by username never reveals the email of the person added', async () => {
    const owner = await createActor('Owner');
    const invitee = await createActor('Invitee');
    const workspace = await createWorkspace(owner);

    const response = await request(`/workspaces/${workspace.id}/members`, {
      method: 'POST',
      actor: owner,
      payload: { username: invitee.username, role: 'GUEST' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().member.email).toBeNull();
    expect(response.body).not.toContain(invitee.email);
  });

  test('email and username together, or neither, is refused', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const url = `/workspaces/${workspace.id}/members`;

    const both = await request(url, {
      method: 'POST',
      actor: owner,
      payload: { email: 'a@robis.test', username: 'someone', role: 'MEMBER' },
    });
    const neither = await request(url, {
      method: 'POST',
      actor: owner,
      payload: { role: 'MEMBER' },
    });

    expect(both.statusCode).toBe(400);
    expect(neither.statusCode).toBe(400);
  });

  test('teammates see each other by username; only admins see email addresses', async () => {
    const owner = await createActor('Owner');
    const member = await createActor('Member');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');

    const asMember = (
      await request(`/workspaces/${workspace.id}/members`, { actor: member })
    ).json().members as { username: string; email: string | null }[];
    const asOwner = (await request(`/workspaces/${workspace.id}/members`, { actor: owner })).json()
      .members as { username: string; email: string | null }[];

    expect(asMember.every((m) => m.email === null && m.username.length > 0)).toBe(true);
    expect(asOwner.every((m) => m.email !== null)).toBe(true);
  });

  test('the audit trail names a member by username, never by email or real name', async () => {
    const { db } = await getHarness();
    const owner = await createActor('Owner');
    const member = await createActor('Member Person');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, member, 'MEMBER');
    await request(`/workspaces/${workspace.id}/members/${member.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { role: 'ADMIN' },
    });

    const events = await db
      .select({ type: auditEvents.eventType, payload: auditEvents.payload })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspace.id));

    const memberEvents = events.filter((event) => event.type.startsWith('member.'));
    expect(memberEvents.length).toBe(2);
    for (const event of memberEvents) {
      expect(JSON.parse(event.payload).username).toBe(member.username);
      expect(event.payload).not.toContain(member.email);
      expect(event.payload).not.toContain('Member Person');
    }
  });
});
