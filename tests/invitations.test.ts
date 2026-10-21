import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { auditEvents, users, workspaceInvitations, workspaceMembers } from '@robis/database';
import { MAX_PENDING_INVITATIONS } from '@robis/shared';
import { and, asc, eq } from 'drizzle-orm';
import {
  type Actor,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Adding someone to a workspace is an invitation, not a fact about them:
 * they see it, and accept or decline. Accepting needs a confirmed email,
 * which is what a verified address gates (ROADMAP item 4).
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function verify(actor: Actor) {
  const { db } = await getHarness();
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, actor.id));
}

function invite(actor: Actor, workspaceId: string, invitee: Actor, role = 'MEMBER') {
  return request(`/workspaces/${workspaceId}/members`, {
    method: 'POST',
    actor,
    payload: { username: invitee.username, role },
  });
}

async function pending(actor: Actor) {
  return (await request('/invitations', { actor })).json().invitations as {
    id: string;
    role: string;
    workspace: { id: string; name: string };
    invitedBy: string | null;
  }[];
}

async function workspaceIds(actor: Actor) {
  const list = (await request('/workspaces', { actor })).json();
  return (list.workspaces as { id: string }[]).map((workspace) => workspace.id);
}

async function setup() {
  const owner = await createActor('Owner');
  const invitee = await createActor('Invitee');
  const workspace = await createWorkspace(owner, 'Design');
  const response = await invite(owner, workspace.id, invitee);
  expect(response.statusCode).toBe(201);
  return { owner, invitee, workspace, invitationId: response.json().invitation.id as string };
}

async function trailTypes(workspaceId: string) {
  const { db } = await getHarness();
  const rows = await db
    .select({ type: auditEvents.eventType, actorId: auditEvents.actorId })
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(asc(auditEvents.seq));
  return rows;
}

describe('an invitation', () => {
  test('is pending until accepted: the workspace is not theirs yet', async () => {
    const { owner, invitee, workspace } = await setup();

    expect(await workspaceIds(invitee)).toEqual([]);
    const [mine] = await pending(invitee);
    expect(mine).toMatchObject({
      role: 'MEMBER',
      workspace: { id: workspace.id, name: 'Design' },
      invitedBy: owner.username,
    });

    const members = (await request(`/workspaces/${workspace.id}/members`, { actor: owner })).json();
    expect(members.members.map((m: { userId: string }) => m.userId)).not.toContain(invitee.id);
    const invites = (
      await request(`/workspaces/${workspace.id}/invitations`, { actor: owner })
    ).json();
    expect(invites.invitations.map((i: { userId: string }) => i.userId)).toEqual([invitee.id]);

    // Not a member, so the workspace does not exist as far as they can tell.
    const peek = await request(`/workspaces/${workspace.id}/projects`, { actor: invitee });
    expect(peek.statusCode).toBe(404);
  });

  test('reaches the invited person in their inbox', async () => {
    const { invitee } = await setup();
    const inbox = (await request('/notifications', { actor: invitee })).json();
    expect(inbox.notifications.map((n: { kind: string }) => n.kind)).toEqual(['invitation']);
  });

  test('cannot be accepted before the email address is confirmed', async () => {
    const { invitee, invitationId } = await setup();
    const response = await request(`/invitations/${invitationId}/accept`, {
      method: 'POST',
      actor: invitee,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('email_unverified');
  });

  test('accepted, makes them a member, and the trail says who did what', async () => {
    const { owner, invitee, workspace, invitationId } = await setup();
    await verify(invitee);

    const response = await request(`/invitations/${invitationId}/accept`, {
      method: 'POST',
      actor: invitee,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().workspace.id).toBe(workspace.id);

    expect(await workspaceIds(invitee)).toEqual([workspace.id]);
    expect(await pending(invitee)).toEqual([]);

    const types = await trailTypes(workspace.id);
    expect(types.find((e) => e.type === 'member.invited')?.actorId).toBe(owner.id);
    expect(types.find((e) => e.type === 'member.joined')?.actorId).toBe(invitee.id);
  });

  test('accepted twice with the same key, joins once and answers the same', async () => {
    const { invitee, workspace, invitationId } = await setup();
    await verify(invitee);
    const send = () =>
      request(`/invitations/${invitationId}/accept`, {
        method: 'POST',
        actor: invitee,
        headers: { 'idempotency-key': 'accept-once' },
      });

    const first = await send();
    const second = await send();
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());

    const { db } = await getHarness();
    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, invitee.id),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  test('declined, goes away and leaves them outside', async () => {
    const { invitee, workspace, invitationId } = await setup();
    const response = await request(`/invitations/${invitationId}/decline`, {
      method: 'POST',
      actor: invitee,
    });
    expect(response.statusCode).toBe(204);
    expect(await pending(invitee)).toEqual([]);
    expect(await workspaceIds(invitee)).toEqual([]);
    expect((await trailTypes(workspace.id)).map((e) => e.type)).toContain('member.invite_declined');
  });

  test('withdrawn by an admin, cannot be accepted', async () => {
    const { owner, invitee, workspace, invitationId } = await setup();
    await verify(invitee);
    const withdrawn = await request(`/workspaces/${workspace.id}/invitations/${invitationId}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(withdrawn.statusCode).toBe(204);
    expect(await pending(invitee)).toEqual([]);

    const late = await request(`/invitations/${invitationId}/accept`, {
      method: 'POST',
      actor: invitee,
    });
    expect(late.statusCode).toBe(404);
    expect((await trailTypes(workspace.id)).map((e) => e.type)).toContain('member.invite_revoked');
  });

  test('belongs to the person invited: nobody else can accept or decline it', async () => {
    const { owner, invitationId } = await setup();
    const stranger = await createActor('Stranger');
    await verify(stranger);
    for (const action of ['accept', 'decline']) {
      for (const actor of [stranger, owner]) {
        const response = await request(`/invitations/${invitationId}/${action}`, {
          method: 'POST',
          actor,
        });
        expect(response.statusCode).toBe(404);
      }
    }
  });

  test('is listed only for people who may invite: 404 outside, 403 without the right', async () => {
    const { owner, workspace } = await setup();
    const outsider = await createActor('Outsider');
    const guest = await createActor('Guest');
    await verify(guest);
    const asked = await invite(owner, workspace.id, guest, 'GUEST');
    await request(`/invitations/${asked.json().invitation.id}/accept`, {
      method: 'POST',
      actor: guest,
    });

    const url = `/workspaces/${workspace.id}/invitations`;
    expect((await request(url, { actor: outsider })).statusCode).toBe(404);
    expect((await request(url, { actor: guest })).statusCode).toBe(403);
  });

  test('is not sent twice, nor to someone already in', async () => {
    const { owner, invitee, workspace } = await setup();
    const again = await invite(owner, workspace.id, invitee);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('already_invited');

    const self = await invite(owner, workspace.id, owner);
    expect(self.json().error).toBe('already_member');
  });

  test('lapses when the person who sent it can no longer invite', async () => {
    const { owner, workspace } = await setup();
    const admin = await createActor('Admin');
    await verify(admin);
    const promoted = await invite(owner, workspace.id, admin, 'ADMIN');
    await request(`/invitations/${promoted.json().invitation.id}/accept`, {
      method: 'POST',
      actor: admin,
    });

    const friend = await createActor('Friend');
    await verify(friend);
    const asked = await invite(admin, workspace.id, friend, 'ADMIN');
    expect(asked.statusCode).toBe(201);

    // The admin is demoted before the friend answers.
    await request(`/workspaces/${workspace.id}/members/${admin.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { role: 'MEMBER' },
    });

    const late = await request(`/invitations/${asked.json().invitation.id}/accept`, {
      method: 'POST',
      actor: friend,
    });
    expect(late.statusCode).toBe(404);
    expect(late.json().error).toBe('invitation_lapsed');
    expect(await workspaceIds(friend)).toEqual([]);
    expect(await pending(friend)).toEqual([]);
  });

  test('can be withdrawn only by someone who could have sent it', async () => {
    const { owner, workspace } = await setup();
    const admin = await createActor('Admin');
    await verify(admin);
    const promoted = await invite(owner, workspace.id, admin, 'ADMIN');
    await request(`/invitations/${promoted.json().invitation.id}/accept`, {
      method: 'POST',
      actor: admin,
    });

    const heir = await createActor('Heir');
    const asked = await invite(owner, workspace.id, heir, 'OWNER');
    const byAdmin = await request(
      `/workspaces/${workspace.id}/invitations/${asked.json().invitation.id}`,
      { method: 'DELETE', actor: admin },
    );
    expect(byAdmin.statusCode).toBe(403);
  });

  test('throwaway workspaces cannot block a real invitation', async () => {
    const target = await createActor('Target');
    // More strangers than any cap, each with a throwaway workspace.
    for (let n = 0; n <= 11; n++) {
      const stranger = await createActor(`Stranger ${n}`);
      const throwaway = await createWorkspace(stranger, `Throwaway ${n}`);
      expect((await invite(stranger, throwaway.id, target)).statusCode).toBe(201);
    }
    const owner = await createActor('Owner');
    const real = await createWorkspace(owner, 'Real team');
    expect((await invite(owner, real.id, target)).statusCode).toBe(201);
  });

  test('one sender can only have so many unanswered at once', async () => {
    const sender = await createActor('Sender');
    const team = await createWorkspace(sender, 'Team');
    // Written directly: the route's own rate limit would stop a loop of
    // this many first, and that is not what is being tested.
    const { db } = await getHarness();
    for (let n = 0; n < MAX_PENDING_INVITATIONS; n++) {
      const person = await createActor(`Person ${n}`);
      await db
        .insert(workspaceInvitations)
        .values({ workspaceId: team.id, userId: person.id, invitedBy: sender.id });
    }
    const oneMore = await invite(sender, team.id, await createActor('One more'));
    expect(oneMore.statusCode).toBe(409);
    expect(oneMore.json().error).toBe('too_many_invitations');
  });

  test('still cannot make someone an owner unless an owner sends it', async () => {
    const { owner, workspace } = await setup();
    const admin = await createActor('Admin');
    await verify(admin);
    const asked = await invite(owner, workspace.id, admin, 'ADMIN');
    await request(`/invitations/${asked.json().invitation.id}/accept`, {
      method: 'POST',
      actor: admin,
    });

    const outsider = await createActor('Outsider');
    expect((await invite(admin, workspace.id, outsider, 'OWNER')).statusCode).toBe(403);
  });
});
