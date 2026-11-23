import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { issues } from '@robis/database';
import {
  dateKey,
  hourAt,
  lanes,
  placeOn,
  weekOf,
} from '@robis/web/features/calendar/week-model.ts';
import { eq } from 'drizzle-orm';
import {
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
 * The week view (B8). Done when: the week is laid out in the viewer's own
 * zone, a 25-hour day as long as it is; overlapping meetings sit side by
 * side; repeats show each week they fall in; due issues show on their date;
 * and only members who may read meetings see any of it.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const NY = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';

describe('laying out a week', () => {
  test('Monday to Sunday in the viewer’s zone, the window from its midnights', () => {
    // Thursday 29 October 2026, evening in New York.
    const week = weekOf(new Date('2026-10-30T01:00:00Z'), NY);
    expect(week.firstDay).toBe('2026-10-26');
    expect(week.lastDay).toBe('2026-11-01');
    expect(week.from.toISOString()).toBe('2026-10-26T04:00:00.000Z');
    // The week ends at midnight on 2 November, after the clocks went back.
    expect(week.to.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // The same instant is already Friday in Kolkata: the same week there.
    expect(weekOf(new Date('2026-10-30T01:00:00Z'), KOLKATA).firstDay).toBe('2026-10-26');
  });

  test('the 25-hour day is laid out as long as it is', () => {
    const sunday = weekOf(new Date('2026-11-01T12:00:00Z'), NY).days[6]!;
    expect(dateKey(sunday)).toBe('2026-11-01');
    // Noon is 13 of the day's 25 hours from its top, not halfway.
    expect(hourAt(sunday, 12, NY)).toBeCloseTo(13 / 25, 6);
    const placed = placeOn(sunday, new Date('2026-11-01T17:00:00Z'), 60, NY)!;
    expect(placed.top).toBeCloseTo(13 / 25, 6);
    expect(placed.height).toBeCloseTo(1 / 25, 6);
  });

  test('a span is clipped to its day, and not placed on a day it misses', () => {
    const [monday, tuesday] = weekOf(new Date('2026-11-10T12:00:00Z'), 'UTC').days;
    const lateNight = new Date('2026-11-09T23:00:00Z');
    expect(placeOn(monday!, lateNight, 120, 'UTC')).toEqual({ top: 23 / 24, height: 1 / 24 });
    expect(placeOn(tuesday!, lateNight, 120, 'UTC')).toEqual({ top: 0, height: 1 / 24 });
    expect(placeOn(tuesday!, new Date('2026-11-09T10:00:00Z'), 30, 'UTC')).toBeNull();
  });

  test('overlapping spans share lanes; ones apart get the whole width', () => {
    expect(
      lanes([
        { start: 0, end: 2 },
        { start: 1, end: 3 },
        { start: 2.5, end: 4 },
        { start: 5, end: 6 },
      ]),
    ).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });
});

describe('the week over HTTP', () => {
  test('repeats in the week, your answer, and the issues due on its dates', async () => {
    const ada = await createActor('Ada');
    const workspace = await createWorkspace(ada);
    const ben = await createActor('Ben');
    await addMember(ada, workspace.id, ben, 'MEMBER');
    const project = await createProject(ada, workspace.id);
    await request(`/workspaces/${workspace.id}/meetings`, {
      method: 'POST',
      actor: ada,
      payload: { title: 'Weekly', startsAt: '2026-10-22T13:00:00Z', timeZone: NY, repeatCount: 4 },
    });
    const filed = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: ada,
      payload: { title: 'Due Sunday' },
    });
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(issues)
      .set({ dueOn: '2026-11-01' })
      .where(eq(issues.id, filed.json().issue.id));

    const week = weekOf(new Date('2026-10-28T12:00:00Z'), NY);
    const query = new URLSearchParams({
      from: week.from.toISOString(),
      to: week.to.toISOString(),
      firstDay: week.firstDay,
      lastDay: week.lastDay,
    });
    const reply = await request(`/workspaces/${workspace.id}/calendar?${query}`, { actor: ben });
    expect(reply.statusCode).toBe(200);
    const body = reply.json();
    expect(
      body.meetings.map((m: { startsAt: string; week: number; myResponse: unknown }) => [
        m.startsAt,
        m.week,
        m.myResponse,
      ]),
    ).toEqual([['2026-10-29T13:00:00.000Z', 1, null]]);
    expect(body.issues.map((i: { title: string; dueOn: string }) => [i.title, i.dueOn])).toEqual([
      ['Due Sunday', '2026-11-01'],
    ]);

    // The next week holds the occurrence after the change: an hour later in UTC.
    const next = weekOf(new Date('2026-11-04T12:00:00Z'), NY);
    const nextQuery = new URLSearchParams({
      from: next.from.toISOString(),
      to: next.to.toISOString(),
      firstDay: next.firstDay,
      lastDay: next.lastDay,
    });
    const later = (
      await request(`/workspaces/${workspace.id}/calendar?${nextQuery}`, { actor: ada })
    ).json();
    expect(
      later.meetings.map((m: { startsAt: string; myResponse: string }) => [
        m.startsAt,
        m.myResponse,
      ]),
    ).toEqual([['2026-11-05T14:00:00.000Z', 'yes']]);
  });

  test('a window too long or backwards is refused; strangers get 404', async () => {
    const ada = await createActor('Ada');
    const workspace = await createWorkspace(ada);
    const stranger = await createActor('Stranger');
    const ask = (actor: typeof ada, from: string, to: string, firstDay: string, lastDay: string) =>
      request(
        `/workspaces/${workspace.id}/calendar?${new URLSearchParams({ from, to, firstDay, lastDay })}`,
        { actor },
      );
    expect(
      (await ask(ada, '2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z', '2026-11-01', '2026-11-07'))
        .statusCode,
    ).toBe(400);
    expect(
      (await ask(ada, '2026-11-08T00:00:00Z', '2026-11-01T00:00:00Z', '2026-11-01', '2026-11-07'))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await ask(
          stranger,
          '2026-11-01T00:00:00Z',
          '2026-11-08T00:00:00Z',
          '2026-11-01',
          '2026-11-07',
        )
      ).statusCode,
    ).toBe(404);
  });
});
