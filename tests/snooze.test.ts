import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { notifications } from '@robis/database';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  closeHarness,
  createActor,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Snooze (inbox): an entry put off waits under Later, out of the unread
 * count and out of Mark all read, and comes back unread, at the top, once
 * its time comes. Only its own person can snooze it.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const HOUR = 3_600_000;

type Listed = { id: string; readAt: string | null; snoozedUntil: string | null };

async function entries(actor: Actor, keys: string[]) {
  const { ownerDb } = await getHarness();
  const made = await ownerDb
    .insert(notifications)
    .values(
      keys.map((key, index) => ({
        userId: actor.id,
        kind: 'nudge',
        entityType: 'user',
        payload: JSON.stringify({ title: key }),
        dedupeKey: key,
        createdAt: new Date(Date.now() - (keys.length - index) * HOUR),
      })),
    )
    .returning({ id: notifications.id });
  return made.map((row) => row.id);
}

const snooze = (actor: Actor, id: string, until: Date | null) =>
  request(`/notifications/${id}/snooze`, { method: 'PUT', actor, payload: { until } });

const inbox = async (actor: Actor) =>
  (await request('/notifications', { actor })).json() as {
    notifications: Listed[];
    unreadCount: number;
  };

describe('snoozing an entry', () => {
  test('waits out of the count, and Mark all read leaves it', async () => {
    const me = await createActor('Me');
    const [first, second] = await entries(me, ['first', 'second']);
    await request(`/notifications/${first}/read`, { method: 'POST', actor: me });

    const until = new Date(Date.now() + 2 * HOUR);
    const snoozed = await snooze(me, first!, until);
    expect(snoozed.statusCode).toBe(200);
    // Back as unread when it returns, as if new.
    expect(snoozed.json().notification).toMatchObject({ readAt: null });

    const listed = await inbox(me);
    expect(listed.unreadCount).toBe(1);
    expect(listed.notifications.find((n) => n.id === first)?.snoozedUntil).toBe(
      until.toISOString(),
    );

    await request('/notifications/read-all', { method: 'POST', actor: me });
    const after = await inbox(me);
    expect(after.notifications.find((n) => n.id === first)?.readAt).toBeNull();
    expect(after.notifications.find((n) => n.id === second)?.readAt).not.toBeNull();
  });

  test('once its time comes, it is back unread and first', async () => {
    const me = await createActor('Me');
    const [older, newer] = await entries(me, ['older', 'newer']);
    await snooze(me, older!, new Date(Date.now() + HOUR));
    const { ownerDb } = await getHarness();
    // The hour passes.
    await ownerDb
      .update(notifications)
      .set({ snoozedUntil: new Date(Date.now() - 1000) })
      .where(eq(notifications.id, older!));

    const listed = await inbox(me);
    expect(listed.notifications.map((n) => n.id)).toEqual([older!, newer!]);
    expect(listed.unreadCount).toBe(2);
    const unreadOnly = (await request('/notifications?unread=1', { actor: me })).json();
    expect(unreadOnly.notifications).toHaveLength(2);
  });

  test('brought back early, it is out of Later at once', async () => {
    const me = await createActor('Me');
    const [id] = await entries(me, ['one']);
    await snooze(me, id!, new Date(Date.now() + HOUR));
    const back = await snooze(me, id!, null);
    expect(back.json().notification).toMatchObject({ snoozedUntil: null });
    expect((await inbox(me)).unreadCount).toBe(1);
  });

  test('a time past, or more than 90 days ahead, is refused', async () => {
    const me = await createActor('Me');
    const [id] = await entries(me, ['one']);
    for (const until of [new Date(Date.now() - HOUR), new Date(Date.now() + 91 * 24 * HOUR)]) {
      const refused = await snooze(me, id!, until);
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toBe('bad_time');
    }
  });

  test('nobody else can snooze it, and it must be signed in', async () => {
    const me = await createActor('Me');
    const other = await createActor('Other');
    const [id] = await entries(me, ['one']);
    expect((await snooze(other, id!, new Date(Date.now() + HOUR))).statusCode).toBe(404);
    expect((await snooze(other, 'not-an-id', new Date(Date.now() + HOUR))).statusCode).toBe(404);
    const anonymous = await request(`/notifications/${id}/snooze`, {
      method: 'PUT',
      payload: { until: new Date(Date.now() + HOUR) },
    });
    expect(anonymous.statusCode).toBe(401);
    expect((await inbox(me)).notifications[0]?.snoozedUntil).toBeNull();
  });
});
