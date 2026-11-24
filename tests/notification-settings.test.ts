import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { jobs, notifications } from '@robis/database';
import { handlers } from '@robis/worker/handlers';
import { Runner } from '@robis/worker/runner';
import { eq } from 'drizzle-orm';
import {
  type Actor,
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
 * Notification settings (C3): per person, by kind and by channel, and the
 * new kinds (assignment, a comment on your issue, a meeting change). A kind
 * turned off on every channel makes nothing at all; turned off in the app,
 * it stays out of the inbox.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const KINDS = [
  'mention',
  'assignment',
  'issue_comment',
  'meeting',
  'nudge',
  'space_reply',
  'space_answer',
];

async function settingsOf(actor: Actor) {
  const response = await request('/me/notification-settings', { actor });
  expect(response.statusCode).toBe(200);
  return response.json().settings as {
    kind: string;
    channels: { inApp: boolean; email: boolean; push: boolean };
  }[];
}

const set = (actor: Actor, kind: string, channel: string, enabled: boolean) =>
  request('/me/notification-settings', {
    method: 'PUT',
    payload: { kind, channel, enabled },
    actor,
  });

async function turnOff(actor: Actor, kind: string) {
  for (const channel of ['in_app', 'email', 'push']) {
    expect((await set(actor, kind, channel, false)).statusCode).toBe(200);
  }
}

async function runJobs() {
  const { workerDb: db } = await getHarness();
  await new Runner({ db, handlers }).tick();
}

const inbox = async (actor: Actor) =>
  (await request('/notifications', { actor })).json().notifications as {
    kind: string;
    payload: Record<string, unknown>;
  }[];

async function team() {
  const alice = await createActor('Alice');
  const bob = await createActor('Bob');
  const workspace = await createWorkspace(alice);
  const project = await createProject(alice, workspace.id);
  await addMember(alice, workspace.id, bob, 'MEMBER');
  return { alice, bob, workspace, project };
}

async function fileIssue(actor: Actor, workspaceId: string, projectId: string, extra = {}) {
  const response = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    payload: { title: 'Look at the export', ...extra },
    actor,
  });
  expect(response.statusCode).toBe(201);
  return response.json().issue as { id: string; key: string };
}

describe('the settings', () => {
  test('every kind starts on in every channel', async () => {
    const alice = await createActor('Alice');
    const settings = await settingsOf(alice);
    expect(settings.map((s) => s.kind)).toEqual(KINDS);
    for (const s of settings) expect(s.channels).toEqual({ inApp: true, email: true, push: true });
  });

  test('one channel of one kind turns off, and back on', async () => {
    const alice = await createActor('Alice');
    expect((await set(alice, 'assignment', 'email', false)).statusCode).toBe(200);
    // Twice is the same as once.
    expect((await set(alice, 'assignment', 'email', false)).statusCode).toBe(200);

    const off = (await settingsOf(alice)).find((s) => s.kind === 'assignment');
    expect(off?.channels).toEqual({ inApp: true, email: false, push: true });

    await set(alice, 'assignment', 'email', true);
    const on = (await settingsOf(alice)).find((s) => s.kind === 'assignment');
    expect(on?.channels.email).toBe(true);
  });

  test('are yours alone', async () => {
    const alice = await createActor('Alice');
    const bob = await createActor('Bob');
    await set(alice, 'mention', 'in_app', false);
    expect((await settingsOf(bob)).find((s) => s.kind === 'mention')?.channels.inApp).toBe(true);
  });

  test('an unknown kind or channel is refused, and a session is needed', async () => {
    const alice = await createActor('Alice');
    expect((await set(alice, 'everything', 'email', false)).statusCode).toBe(400);
    expect((await set(alice, 'mention', 'pigeon', false)).statusCode).toBe(400);
    expect((await request('/me/notification-settings')).statusCode).toBe(401);
  });
});

describe('assignment', () => {
  test('being given an issue by someone else is a notification', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await fileIssue(alice, workspace.id, project.id);

    await request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
      method: 'PATCH',
      payload: { assigneeId: bob.id },
      actor: alice,
    });
    await runJobs();

    const [item] = await inbox(bob);
    expect(item?.kind).toBe('assignment');
    expect(item?.payload.issueKey).toBe(issue.key);
  });

  test('so is filing one already assigned to them', async () => {
    const { alice, bob, workspace, project } = await team();
    await fileIssue(alice, workspace.id, project.id, { assigneeId: bob.id });
    await runJobs();
    expect((await inbox(bob)).map((n) => n.kind)).toEqual(['assignment']);
  });

  test('taking an issue yourself is not', async () => {
    const { alice, workspace, project } = await team();
    const issue = await fileIssue(alice, workspace.id, project.id);
    await request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
      method: 'PATCH',
      payload: { assigneeId: alice.id },
      actor: alice,
    });
    await runJobs();
    expect(await inbox(alice)).toEqual([]);
  });

  test('a job run twice tells them once', async () => {
    const { alice, bob, workspace, project } = await team();
    await fileIssue(alice, workspace.id, project.id, { assigneeId: bob.id });
    const { workerDb: db } = await getHarness();
    const [job] = await db.select().from(jobs).where(eq(jobs.kind, 'notify.assignment'));
    const payload = JSON.parse(job!.payload);
    for (let i = 0; i < 3; i++) await handlers['notify.assignment']!(payload, { db });
    expect(
      await db.select().from(notifications).where(eq(notifications.userId, bob.id)),
    ).toHaveLength(1);
  });
});

describe('a comment on your issue', () => {
  test('the person who filed it and its assignee are told', async () => {
    const { alice, bob, workspace, project } = await team();
    const carol = await createActor('Carol');
    await addMember(alice, workspace.id, carol, 'MEMBER');
    const issue = await fileIssue(bob, workspace.id, project.id, { assigneeId: carol.id });
    await runJobs();

    await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: 'Still broken for me.' },
      actor: alice,
    });
    await runJobs();

    expect((await inbox(bob)).map((n) => n.kind)).toEqual(['issue_comment']);
    expect((await inbox(carol)).map((n) => n.kind)).toEqual(['issue_comment', 'assignment']);
    // The one who wrote it hears nothing.
    expect(await inbox(alice)).toEqual([]);
  });

  test('someone mentioned in it hears of it once, as a mention', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await fileIssue(bob, workspace.id, project.id);
    await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: `@${bob.username} still broken for me.` },
      actor: alice,
    });
    await runJobs();
    expect((await inbox(bob)).map((n) => n.kind)).toEqual(['mention']);
  });
});

describe('a comment by an agent', () => {
  test('is not news to the issue’s people (the triage agent comments on every new issue)', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await fileIssue(bob, workspace.id, project.id);
    const made = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: alice,
      payload: { name: 'Note bot', role: 'MEMBER' },
    });
    const { token } = made.json();
    const posted = await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: 'Looks like a duplicate of nothing.' },
      headers: { authorization: `Bearer ${token.secret}` },
    });
    expect(posted.statusCode).toBe(201);
    await runJobs();
    expect(await inbox(bob)).toEqual([]);
  });
});

describe('a comment on your issue, with mentions off', () => {
  test('someone who turned mentions off still hears of a comment on their issue', async () => {
    const { alice, bob, workspace, project } = await team();
    await turnOff(bob, 'mention');
    const issue = await fileIssue(bob, workspace.id, project.id);
    await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: `@${bob.username} still broken for me.` },
      actor: alice,
    });
    await runJobs();
    expect((await inbox(bob)).map((n) => n.kind)).toEqual(['issue_comment']);
  });
});

describe('a burst of the same change', () => {
  test('an issue handed back and forth tells its assignee once in a while, not each time', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await fileIssue(alice, workspace.id, project.id);
    for (const assigneeId of [bob.id, alice.id, bob.id, alice.id, bob.id]) {
      await request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
        method: 'PATCH',
        payload: { assigneeId },
        actor: alice,
      });
    }
    await runJobs();
    expect((await inbox(bob)).map((n) => n.kind)).toEqual(['assignment']);
  });
});

describe('a meeting change', () => {
  async function meetingWith(organiser: Actor, attendee: Actor, workspaceId: string) {
    const created = await request(`/workspaces/${workspaceId}/meetings`, {
      method: 'POST',
      payload: {
        title: 'Retro',
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        attendeeIds: [attendee.id],
      },
      actor: organiser,
    });
    expect(created.statusCode).toBe(201);
    return created.json().meeting as { id: string };
  }

  test('moving it tells the attendees, not the one who moved it', async () => {
    const { alice, bob, workspace } = await team();
    const meeting = await meetingWith(alice, bob, workspace.id);

    await request(`/workspaces/${workspace.id}/meetings/${meeting.id}`, {
      method: 'PATCH',
      payload: { startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString() },
      actor: alice,
    });
    await runJobs();

    const [item] = await inbox(bob);
    expect(item?.kind).toBe('meeting');
    expect(item?.payload.change).toBe('moved');
    expect(item?.payload.title).toBe('Retro');
    expect(await inbox(alice)).toEqual([]);
  });

  test('a save that changes nothing, or only the agenda, tells nobody', async () => {
    const { alice, bob, workspace } = await team();
    const meeting = await meetingWith(alice, bob, workspace.id);
    await request(`/workspaces/${workspace.id}/meetings/${meeting.id}`, {
      method: 'PATCH',
      payload: { title: 'Retro' },
      actor: alice,
    });
    await request(`/workspaces/${workspace.id}/meetings/${meeting.id}`, {
      method: 'PATCH',
      payload: { agenda: 'Fix the typo' },
      actor: alice,
    });
    await runJobs();
    expect(await inbox(bob)).toEqual([]);
  });

  test('a new title is a change', async () => {
    const { alice, bob, workspace } = await team();
    const meeting = await meetingWith(alice, bob, workspace.id);
    await request(`/workspaces/${workspace.id}/meetings/${meeting.id}`, {
      method: 'PATCH',
      payload: { title: 'Sprint retro' },
      actor: alice,
    });
    await runJobs();
    const [item] = await inbox(bob);
    expect(item?.payload.change).toBe('changed');
    expect(item?.payload.title).toBe('Sprint retro');
  });

  test('cancelling it does too', async () => {
    const { alice, bob, workspace } = await team();
    const meeting = await meetingWith(alice, bob, workspace.id);
    await request(`/workspaces/${workspace.id}/meetings/${meeting.id}`, {
      method: 'DELETE',
      actor: alice,
    });
    await runJobs();
    expect((await inbox(bob)).map((n) => n.payload.change)).toEqual(['canceled']);
  });
});

describe('turning a kind off', () => {
  test('off everywhere, nothing is made at all', async () => {
    const { alice, bob, workspace, project } = await team();
    await turnOff(bob, 'assignment');
    await fileIssue(alice, workspace.id, project.id, { assigneeId: bob.id });
    await runJobs();

    const { workerDb: db } = await getHarness();
    expect(await db.select().from(notifications).where(eq(notifications.userId, bob.id))).toEqual(
      [],
    );
  });

  test('off in the app only, it stays out of the inbox and its count', async () => {
    const { alice, bob, workspace, project } = await team();
    await set(bob, 'assignment', 'in_app', false);
    await fileIssue(alice, workspace.id, project.id, { assigneeId: bob.id });
    await runJobs();

    const listed = (await request('/notifications', { actor: bob })).json();
    expect(listed.notifications).toEqual([]);
    expect(listed.unreadCount).toBe(0);
  });

  test('one kind off leaves the others alone', async () => {
    const { alice, bob, workspace, project } = await team();
    await turnOff(bob, 'issue_comment');
    const issue = await fileIssue(alice, workspace.id, project.id, { assigneeId: bob.id });
    await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: 'Any news?' },
      actor: alice,
    });
    await runJobs();
    expect((await inbox(bob)).map((n) => n.kind)).toEqual(['assignment']);
  });

  test('mentions follow the setting too', async () => {
    const { alice, bob, workspace, project } = await team();
    await turnOff(bob, 'mention');
    const issue = await fileIssue(alice, workspace.id, project.id);
    await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
      method: 'POST',
      payload: { body: `@${bob.username} have a look` },
      actor: alice,
    });
    await runJobs();
    expect(await inbox(bob)).toEqual([]);
  });
});
