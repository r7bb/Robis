import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { base32Decode, totpAt, totpStep } from '@robis/auth';
import { notifications, notify } from '@robis/database';
import { inArray } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * A workspace that requires two-factor sign-in (C4). Done when: a member
 * without it is refused, with a clear message, while the rest is as before.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Actor = Awaited<ReturnType<typeof createActor>>;

async function turnOnTwoFactor(actor: Actor) {
  const setup = await request('/auth/two-factor/setup', {
    method: 'POST',
    actor,
    payload: { password: ACTOR_PASSWORD },
  });
  const { secret } = setup.json();
  await request('/auth/two-factor/enable', {
    method: 'POST',
    actor,
    payload: { code: totpAt(base32Decode(secret)!, totpStep()) },
  });
}

const require2fa = (actor: Actor, workspaceId: string, required: boolean) =>
  request(`/workspaces/${workspaceId}/two-factor-required`, {
    method: 'PUT',
    actor,
    payload: { required },
  });

async function setUp() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  await turnOnTwoFactor(owner);
  return { owner, member, workspace };
}

describe('requiring two-factor of a workspace', () => {
  test('an admin without it cannot turn it on, and is told why', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const refused = await require2fa(owner, workspace.id, true);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('two_factor_needed_first');
  });

  test('an admin with it turns it on, and the workspace says so', async () => {
    const { owner, workspace } = await setUp();
    const on = await require2fa(owner, workspace.id, true);
    expect(on.statusCode).toBe(200);
    expect(on.json().workspace.requireTwoFactor).toBe(true);
    const read = await request(`/workspaces/${workspace.id}`, { actor: owner });
    expect(read.json().workspace.requireTwoFactor).toBe(true);
  });

  test('a member without it is refused with a clear message, on every workspace route', async () => {
    const { owner, member, workspace } = await setUp();
    const project = await createProject(owner, workspace.id);
    await require2fa(owner, workspace.id, true);

    for (const path of [
      `/workspaces/${workspace.id}`,
      `/workspaces/${workspace.id}/projects`,
      `/workspaces/${workspace.id}/projects/${project.id}/issues`,
      `/workspaces/${workspace.id}/channels`,
    ]) {
      const refused = await request(path, { actor: member });
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toBe('two_factor_required');
      expect(refused.json().message).toMatch(/two-factor sign-in.*account page/i);
    }
  });

  test('once the member turns it on, they are let in', async () => {
    const { owner, member, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    await turnOnTwoFactor(member);
    expect((await request(`/workspaces/${workspace.id}`, { actor: member })).statusCode).toBe(200);
  });

  test('a stranger still gets 404, not the reason', async () => {
    const { owner, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    const stranger = await createActor('Stranger');
    expect((await request(`/workspaces/${workspace.id}`, { actor: stranger })).statusCode).toBe(
      404,
    );
  });

  test('a member may still leave without it', async () => {
    const { owner, member, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    const left = await request(`/workspaces/${workspace.id}/members/me`, {
      method: 'DELETE',
      actor: member,
    });
    expect(left.statusCode).toBeLessThan(300);
  });

  test('an agent acting with its token is not asked', async () => {
    const { owner, workspace } = await setUp();
    const project = await createProject(owner, workspace.id);
    const created = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Helper', role: 'MEMBER' },
    });
    const { token } = created.json();
    await require2fa(owner, workspace.id, true);
    const listed = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      headers: { authorization: `Bearer ${token.secret}` },
    });
    expect(listed.statusCode).toBe(200);
  });

  test('the home shows nothing of what is inside to a member without it', async () => {
    const { owner, member, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    const overview = await request('/workspaces/overview', { actor: member });
    expect(overview.statusCode).toBe(200);
    expect(overview.json().workspaces.map((w: { id: string }) => w.id)).not.toContain(workspace.id);
  });

  test('turned off again, the member is let back in, and both changes are audited', async () => {
    const { owner, member, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    await require2fa(owner, workspace.id, false);
    expect((await request(`/workspaces/${workspace.id}`, { actor: member })).statusCode).toBe(200);
    const trail = await request(`/workspaces/${workspace.id}/audit/events`, { actor: owner });
    const changes = trail
      .json()
      .events.filter((e: { type: string }) => e.type === 'workspace.two_factor_required');
    expect(changes.map((e: { payload: { required: boolean } }) => e.payload.required)).toEqual([
      false,
      true,
    ]);
  });

  test('a member who is not an admin may not change it', async () => {
    const { owner, member, workspace } = await setUp();
    await turnOnTwoFactor(member);
    expect((await require2fa(member, workspace.id, true)).statusCode).toBe(403);
    expect(
      (await request(`/workspaces/${workspace.id}`, { actor: owner })).json().workspace
        .requireTwoFactor,
    ).toBe(false);
  });

  test('your own account page knows whether you have it', async () => {
    const { owner, member } = await setUp();
    expect((await request('/auth/me', { actor: owner })).json().user.twoFactorEnabled).toBe(true);
    expect((await request('/auth/me', { actor: member })).json().user.twoFactorEnabled).toBe(false);
  });
});

describe('what a member without it sees elsewhere (C4)', () => {
  const mention = (userId: string, workspaceId: string) => ({
    userId,
    workspaceId,
    actorId: null,
    kind: 'mention',
    entityType: 'comment',
    entityId: null,
    dedupeKey: `mention:${userId}:${workspaceId}`,
    payload: { title: 'Secret plans' },
  });

  test('the inbox leaves out notices from that workspace until they have it', async () => {
    const { owner, member, workspace } = await setUp();
    const { db } = await getHarness();
    await notify(db, [mention(member.id, workspace.id)]);
    await require2fa(owner, workspace.id, true);

    const hidden = await request('/notifications', { actor: member });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().notifications).toHaveLength(0);

    await turnOnTwoFactor(member);
    const shown = await request('/notifications', { actor: member });
    expect(shown.json().notifications).toHaveLength(1);
  });

  test('my meetings leave out that workspace until they have it', async () => {
    const { owner, member, workspace } = await setUp();
    const startsAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const made = await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Board', startsAt, durationMinutes: 30, attendeeIds: [member.id] },
    });
    expect(made.statusCode).toBe(201);
    await require2fa(owner, workspace.id, true);

    const query = new URLSearchParams({
      from: new Date().toISOString(),
      to: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
    });
    const hidden = await request(`/me/meetings?${query}`, { actor: member });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json().meetings).toHaveLength(0);
    const own = await request(`/me/meetings?${query}`, { actor: owner });
    expect(own.json().meetings).toHaveLength(1);
  });

  test('no mail or push is sent them from that workspace; the notice waits', async () => {
    const { owner, member, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    const { db } = await getHarness();
    await notify(db, [mention(member.id, workspace.id), mention(owner.id, workspace.id)]);

    const rows = await db
      .select({ userId: notifications.userId, emailDue: notifications.emailDue })
      .from(notifications)
      .where(inArray(notifications.userId, [member.id, owner.id]));
    const due = new Map(rows.map((row) => [row.userId, row.emailDue]));
    expect(due.get(member.id)).toBeNull();
    expect(due.get(owner.id)).toBe('now');
  });
});

describe('turning your own off while a workspace requires it (C4)', () => {
  test('an owner of that workspace is refused, and told where', async () => {
    const { owner, workspace } = await setUp();
    await require2fa(owner, workspace.id, true);
    const refused = await request('/auth/two-factor/disable', {
      method: 'POST',
      actor: owner,
      payload: { password: ACTOR_PASSWORD, code: '000000' },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('two_factor_required_where_you_admin');
    expect(refused.json().message).toContain(workspace.name);
    expect((await request('/auth/me', { actor: owner })).json().user.twoFactorEnabled).toBe(true);
  });
});
