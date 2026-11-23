import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { feedText } from '@robis/api/calendar';
import { escapeText, fold } from '@robis/api/ics';
import { loggableUrl } from '@robis/api/tracing';
import { users } from '@robis/database';
import { wallOf } from '@robis/shared';
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
 * Calendar feeds (B8). Done when: an exported feed shows correct local
 * times across the clock change, and a revoked feed token returns 404.
 * Also: the feed holds only that person's meetings, carries the reset
 * pages' headers, a new feed replaces the old, and weekly repeats stay
 * upcoming until their last week.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const NY = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';
const DAY = 86_400_000;

/** The DTSTART of every event in a feed, as instants. */
function starts(ics: string): Date[] {
  const unfolded = ics.replace(/\r\n /g, '');
  return [...unfolded.matchAll(/^DTSTART:(\d{8}T\d{6}Z)$/gm)].map(([, stamp]) => {
    const s = stamp!;
    return new Date(
      `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`,
    );
  });
}

const clock = (date: Date, zone: string) => {
  const wall = wallOf(date, zone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
};

async function schedule(actor: Actor, workspaceId: string, fields: Record<string, unknown>) {
  const made = await request(`/workspaces/${workspaceId}/meetings`, {
    method: 'POST',
    actor,
    payload: { title: 'Planning', durationMinutes: 30, ...fields },
  });
  return made;
}

async function pair() {
  const ada = await createActor('Ada');
  const workspace = await createWorkspace(ada);
  const ben = await createActor('Ben');
  await addMember(ada, workspace.id, ben, 'MEMBER');
  return { ada, ben, workspace };
}

describe('across the November clock change', () => {
  test('a feed shows each occurrence at the right local time in New York and Kolkata', async () => {
    const { ada, ben, workspace } = await pair();
    // Weekly at 09:00 in New York, three weeks from 22 October 2026.
    const fromNewYork = await schedule(ada, workspace.id, {
      title: 'Stand-up',
      startsAt: '2026-10-22T13:00:00Z',
      timeZone: NY,
      repeatCount: 3,
      attendeeIds: [ben.id],
    });
    expect(fromNewYork.statusCode).toBe(201);
    // Weekly at 19:00 in Kolkata, the same three weeks.
    await schedule(ada, workspace.id, {
      title: 'Evening sync',
      startsAt: '2026-10-22T13:30:00Z',
      timeZone: KOLKATA,
      repeatCount: 3,
      attendeeIds: [ben.id],
    });

    const { ownerDb } = await getHarness();
    const ics = await feedText(
      ownerDb,
      { id: ben.id, hasTwoFactor: false },
      new Date('2026-10-20T00:00:00Z'),
      'http://localhost:3000',
    );
    const events = ics.replace(/\r\n /g, '').split('BEGIN:VEVENT').slice(1);
    const startsOf = (title: string) =>
      starts(events.filter((e) => e.includes(`SUMMARY:${title}`)).join('\n'));

    const standUp = startsOf('Stand-up');
    expect(standUp.map((d) => d.toISOString())).toEqual([
      '2026-10-22T13:00:00.000Z',
      '2026-10-29T13:00:00.000Z',
      '2026-11-05T14:00:00.000Z',
    ]);
    expect(standUp.map((d) => clock(d, NY))).toEqual(['09:00', '09:00', '09:00']);
    expect(standUp.map((d) => clock(d, KOLKATA))).toEqual(['18:30', '18:30', '19:30']);

    const evening = startsOf('Evening sync');
    expect(evening.map((d) => clock(d, KOLKATA))).toEqual(['19:00', '19:00', '19:00']);
    expect(evening.map((d) => clock(d, NY))).toEqual(['09:30', '09:30', '08:30']);

    // Each occurrence its own event, with its own stable id.
    expect(ics.match(/^UID:/gm)).toHaveLength(6);
  });
});

describe('the feed over HTTP', () => {
  /** A feed's path on the API, from the address the API handed out. */
  const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+\/api/, '');

  async function makeFeed(actor: Actor) {
    const made = await request('/me/calendar-feed', { method: 'POST', actor });
    expect(made.statusCode).toBe(201);
    return made.json().url as string;
  }

  test("a person's meetings, nobody else's, with the reset pages' headers", async () => {
    const { ada, ben, workspace } = await pair();
    const tomorrow = new Date(Date.now() + DAY).toISOString();
    await schedule(ada, workspace.id, {
      title: 'Ben is in this',
      startsAt: tomorrow,
      attendeeIds: [ben.id],
    });
    await schedule(ada, workspace.id, { title: 'Only Ada', startsAt: tomorrow });

    const url = await makeFeed(ben);
    expect(url).toMatch(/^http:\/\/localhost:3000\/api\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);
    const feed = await request(pathOf(url));
    expect(feed.statusCode).toBe(200);
    expect(feed.headers['content-type']).toContain('text/calendar');
    expect(feed.headers['referrer-policy']).toBe('no-referrer');
    expect(feed.headers['cache-control']).toBe('no-store');
    expect(feed.body).toStartWith('BEGIN:VCALENDAR\r\n');
    expect(feed.body).toContain('SUMMARY:Ben is in this');
    expect(feed.body).not.toContain('Only Ada');
  });

  test('a revoked feed is a 404, and a new feed replaces the old', async () => {
    const { ben } = await pair();
    const first = await makeFeed(ben);
    const second = await makeFeed(ben);
    expect((await request(pathOf(first))).statusCode).toBe(404);
    expect((await request(pathOf(second))).statusCode).toBe(200);

    expect((await request('/me/calendar-feed', { method: 'DELETE', actor: ben })).statusCode).toBe(
      204,
    );
    expect((await request(pathOf(second))).statusCode).toBe(404);
    const after = (await request('/me/calendar-feed', { actor: ben })).json() as { feed: unknown };
    expect(after.feed).toBeNull();
  });

  test('anything that is not a live token is the same 404', async () => {
    const valid = `${'a'.repeat(43)}.ics`;
    for (const file of [valid, 'short.ics', `${'a'.repeat(43)}`, `${'a'.repeat(43)}.txt`]) {
      expect((await request(`/calendar/${file}`)).statusCode).toBe(404);
    }
  });

  test('only a signed-in person manages a feed, and its address is never shown again', async () => {
    const { ben } = await pair();
    expect((await request('/me/calendar-feed')).statusCode).toBe(401);
    await makeFeed(ben);
    const status = (await request('/me/calendar-feed', { actor: ben })).json();
    expect(Object.keys(status.feed)).toEqual(['createdAt']);
  });
});

describe('meetings that repeat', () => {
  test('a time zone the server does not know, or a repeat out of range, is refused', async () => {
    const { ada, workspace } = await pair();
    const startsAt = new Date(Date.now() + DAY).toISOString();
    expect(
      (await schedule(ada, workspace.id, { startsAt, timeZone: 'Mars/Base' })).statusCode,
    ).toBe(400);
    expect((await schedule(ada, workspace.id, { startsAt, repeatCount: 1 })).statusCode).toBe(400);
    expect((await schedule(ada, workspace.id, { startsAt, repeatCount: 53 })).statusCode).toBe(400);
  });

  test('stays upcoming after its first week, showing the next occurrence', async () => {
    const { ada, workspace } = await pair();
    const first = new Date(Date.now() - 3 * DAY);
    await schedule(ada, workspace.id, {
      title: 'Weekly review',
      startsAt: first.toISOString(),
      timeZone: 'UTC',
      repeatCount: 4,
    });
    const listed = await request(`/workspaces/${workspace.id}/meetings`, { actor: ada });
    const [meeting] = listed.json().meetings;
    expect(meeting?.title).toBe('Weekly review');
    expect(meeting.repeatCount).toBe(4);
    expect(new Date(meeting.nextStartsAt).getTime()).toBe(first.getTime() + 7 * DAY);
  });
});

describe('the file itself', () => {
  test('reserved characters escaped, long lines folded at 75 octets, multibyte kept whole', () => {
    expect(escapeText('a, b; c\\d\nnext')).toBe('a\\, b\\; c\\\\d\\nnext');
    const folded = fold(`SUMMARY:${'é'.repeat(60)}`);
    const lines = folded.split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'é'.repeat(60)}`);
  });
});

describe('what the review asked for', () => {
  const pathOf = (url: string) => url.replace(/^https?:\/\/[^/]+\/api/, '');

  test('a bare carriage return, a Unicode line break or a control character cannot start a property', () => {
    expect(escapeText('x\rURL:https://evil')).toBe('x\\nURL:https://evil');
    expect(escapeText('a\u2028b\u0085c')).toBe('a\\nb\\nc');
    expect(escapeText('a\u0000b\u001bc')).toBe('abc');
  });

  test('the log keeps a feed request, never its token', () => {
    expect(loggableUrl(`/calendar/${'a'.repeat(43)}.ics`)).toBe('/calendar/[feed]');
    expect(loggableUrl('/workspaces/x/meetings')).toBe('/workspaces/x/meetings');
  });

  test('a zone is stored in its canonical spelling; a bare offset is refused', async () => {
    const { ada, workspace } = await pair();
    const startsAt = new Date(Date.now() + DAY).toISOString();
    const made = await schedule(ada, workspace.id, { startsAt, timeZone: 'europe/london' });
    expect(made.statusCode).toBe(201);
    expect(made.json().meeting.timeZone).toBe('Europe/London');
    expect((await schedule(ada, workspace.id, { startsAt, timeZone: '+05:30' })).statusCode).toBe(
      400,
    );
  });

  test('changing the repeat moves the meeting between upcoming and past', async () => {
    const { ada, workspace } = await pair();
    const first = new Date(Date.now() - 10 * DAY).toISOString();
    const made = await schedule(ada, workspace.id, {
      title: 'Ending',
      startsAt: first,
      repeatCount: 4,
    });
    const id = made.json().meeting.id as string;
    const titles = async (scope: string) =>
      (await request(`/workspaces/${workspace.id}/meetings?scope=${scope}`, { actor: ada }))
        .json()
        .meetings.map((m: { title: string }) => m.title);
    expect(await titles('upcoming')).toContain('Ending');
    const cleared = await request(`/workspaces/${workspace.id}/meetings/${id}`, {
      method: 'PATCH',
      actor: ada,
      payload: { repeatCount: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(await titles('upcoming')).not.toContain('Ending');
    expect(await titles('past')).toContain('Ending');
  });

  test('a feed drops a workspace its owner has left, and a deleted account has no feed', async () => {
    const { ada, ben, workspace } = await pair();
    await schedule(ada, workspace.id, {
      title: 'Before Ben left',
      startsAt: new Date(Date.now() + DAY).toISOString(),
      attendeeIds: [ben.id],
    });
    const url = (await request('/me/calendar-feed', { method: 'POST', actor: ben })).json()
      .url as string;
    expect((await request(pathOf(url))).body).toContain('Before Ben left');

    const removed = await request(`/workspaces/${workspace.id}/members/${ben.id}`, {
      method: 'DELETE',
      actor: ada,
    });
    expect(removed.statusCode).toBe(204);
    expect((await request(pathOf(url))).body).not.toContain('Before Ben left');

    const { ownerDb } = await getHarness();
    await ownerDb.update(users).set({ deletedAt: new Date() }).where(eq(users.id, ben.id));
    expect((await request(pathOf(url))).statusCode).toBe(404);
  });
});
