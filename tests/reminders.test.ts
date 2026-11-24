import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { jobs, notifications, PUSH_NOTIFICATION_JOB, pushSubscriptions } from '@robis/database';
import { describeNotification, notificationHref } from '@robis/web/lib/notification-text.ts';
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
 * Remind me: a reminder waits under Later for its own person only, comes
 * back unread at its time naming what it is about, and is pushed then to
 * a device that takes pushes; another workspace's thing is not found.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const HOUR = 3_600_000;

type Entry = {
  id: string;
  kind: string;
  workspaceId: string | null;
  actorName: string | null;
  snoozedUntil: string | null;
  payload: Record<string, string>;
};

async function post<T>(actor: Actor, url: string, payload: unknown, key: string) {
  const response = await request(url, { method: 'POST', actor, payload });
  if (response.statusCode !== 201) throw new Error(`${url}: ${response.statusCode}`);
  return response.json()[key] as T & { id: string };
}

const remind = (actor: Actor, ws: string, about: string, id: string, at: Date) =>
  request(`${ws}/reminders`, { method: 'POST', actor, payload: { about, id, at } });

const inbox = async (actor: Actor) =>
  (await request('/notifications', { actor })).json() as {
    notifications: Entry[];
    unreadCount: number;
  };

async function team() {
  const me = await createActor('Me');
  const workspace = await createWorkspace(me);
  return { me, workspaceId: workspace.id, ws: `/workspaces/${workspace.id}` };
}

describe('remind me', () => {
  test('an issue: waits under Later, then back unread with its key', async () => {
    const { me, workspaceId, ws } = await team();
    const project = await createProject(me, workspaceId);
    const issue = await post(
      me,
      `${ws}/projects/${project.id}/issues`,
      { title: 'Fix export' },
      'issue',
    );
    const at = new Date(Date.now() + 2 * HOUR);

    const made = await remind(me, ws, 'issue', issue.id, at);
    expect(made.statusCode).toBe(201);
    expect(made.json().reminder.at).toBe(at.toISOString());

    let listed = await inbox(me);
    expect(listed.unreadCount).toBe(0);
    const entry = listed.notifications[0]!;
    expect(entry).toMatchObject({ kind: 'reminder', snoozedUntil: at.toISOString() });
    expect(describeNotification(entry)).toMatchObject({
      actor: 'Reminder',
      subject: expect.stringMatching(/-1$/),
      body: 'Fix export',
    });
    expect(notificationHref(entry)).toBe(`/workspaces/${workspaceId}/issues/${issue.id}`);

    // Its time comes.
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(notifications)
      .set({ snoozedUntil: new Date(Date.now() - 1000) })
      .where(eq(notifications.id, entry.id));
    listed = await inbox(me);
    expect(listed.unreadCount).toBe(1);
  });

  test('a chat message and a thread lead to the message and the thread', async () => {
    const { me, workspaceId, ws } = await team();
    const room = await post(me, `${ws}/channels`, { name: 'ops' }, 'channel');
    const message = await post(
      me,
      `${ws}/channels/${room.id}/messages`,
      { body: 'Rotate the keys on Friday' },
      'message',
    );
    const space = await post(me, `${ws}/spaces`, { name: 'Desk' }, 'space');
    const thread = await post(
      me,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'idea', title: 'A quieter standup', body: '' },
      'thread',
    );
    const at = new Date(Date.now() + HOUR);
    expect((await remind(me, ws, 'message', message.id, at)).statusCode).toBe(201);
    expect((await remind(me, ws, 'thread', thread.id, at)).statusCode).toBe(201);

    const entries = (await inbox(me)).notifications;
    const hrefs = entries.map((entry) => notificationHref(entry)).sort();
    expect(hrefs).toEqual(
      [
        `/workspaces/${workspaceId}?channel=${room.id}#message-${message.id}`,
        `/workspaces/${workspaceId}/spaces/threads/${thread.id}`,
      ].sort(),
    );
    const onMessage = entries.find((entry) => entry.payload.messageId)!;
    expect(describeNotification(onMessage)).toMatchObject({
      subject: '#ops',
      body: 'Rotate the keys on Friday',
    });
  });

  test('pushed at its time to a device that takes pushes, and only then', async () => {
    const { me, ws } = await team();
    const space = await post(me, `${ws}/spaces`, { name: 'Desk' }, 'space');
    const thread = await post(
      me,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'idea', title: 'Later', body: '' },
      'thread',
    );
    const { ownerDb } = await getHarness();
    await ownerDb
      .insert(pushSubscriptions)
      .values({ userId: me.id, endpoint: 'https://push.example/device-1' });
    const at = new Date(Date.now() + 5 * HOUR);
    await remind(me, ws, 'thread', thread.id, at);

    const queued = await ownerDb.select().from(jobs).where(eq(jobs.kind, PUSH_NOTIFICATION_JOB));
    expect(queued).toHaveLength(1);
    expect(Math.abs(queued[0]!.runAt.getTime() - at.getTime())).toBeLessThan(5_000);
  });

  test('another workspace, a time past or too far, and nobody signed out', async () => {
    const { me, ws } = await team();
    const other = await createActor('Other');
    const theirs = await createWorkspace(other, 'Theirs');
    const space = await post(other, `/workspaces/${theirs.id}/spaces`, { name: 'Desk' }, 'space');
    const thread = await post(
      other,
      `/workspaces/${theirs.id}/spaces/${space.id}/threads`,
      { kind: 'idea', title: 'Theirs', body: '' },
      'thread',
    );
    const soon = new Date(Date.now() + HOUR);
    expect((await remind(me, ws, 'thread', thread.id, soon)).statusCode).toBe(404);
    expect(
      (await remind(me, `/workspaces/${theirs.id}`, 'thread', thread.id, soon)).statusCode,
    ).toBe(404);

    const mine = await post(me, `${ws}/spaces`, { name: 'Mine' }, 'space');
    const myThread = await post(
      me,
      `${ws}/spaces/${mine.id}/threads`,
      { kind: 'idea', title: 'Mine', body: '' },
      'thread',
    );
    for (const at of [new Date(Date.now() - HOUR), new Date(Date.now() + 100 * 24 * HOUR)]) {
      const refused = await remind(me, ws, 'thread', myThread.id, at);
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toBe('bad_time');
    }
    const anonymous = await request(`${ws}/reminders`, {
      method: 'POST',
      payload: { about: 'thread', id: myThread.id, at: soon },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  test('a guest may be reminded too, and only they see it', async () => {
    const { me, workspaceId, ws } = await team();
    const guest = await createActor('Guest');
    await addMember(me, workspaceId, guest, 'GUEST');
    const space = await post(me, `${ws}/spaces`, { name: 'Desk' }, 'space');
    const thread = await post(
      me,
      `${ws}/spaces/${space.id}/threads`,
      { kind: 'idea', title: 'For later', body: '' },
      'thread',
    );
    expect(
      (await remind(guest, ws, 'thread', thread.id, new Date(Date.now() + HOUR))).statusCode,
    ).toBe(201);
    expect((await inbox(guest)).notifications).toHaveLength(1);
    expect((await inbox(me)).notifications).toEqual([]);
  });
});
