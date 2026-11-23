import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { parseCalendar, unescapeText } from '@robis/api/calendar-parse';
import { meetingAttendees, meetings } from '@robis/database';
import { occurrences, wallOf } from '@robis/shared';
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
 * Importing meetings from an .ics file (B8). Done when: timed events in
 * UTC, a named zone or floating time become meetings at the right instant;
 * weekly repeats keep their local time across the clock change; invitees
 * are the file's attendees intersected with the roster like any invitation;
 * and what cannot be taken is left out with a reason, never guessed.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const ics = (...events: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('reading a file', () => {
  test('UTC, a named zone and floating time each land on the right instant', () => {
    const { meetings: read } = parseCalendar(
      ics(
        event('SUMMARY:In UTC', 'DTSTART:20261105T140000Z', 'DTEND:20261105T143000Z'),
        event(
          'SUMMARY:In New York',
          'DTSTART;TZID=America/New_York:20261105T090000',
          'DURATION:PT45M',
        ),
        event('SUMMARY:Floating', 'DTSTART:20261105T190000', 'DURATION:PT1H'),
      ),
      'Asia/Kolkata',
    );
    expect(
      read.map((m) => [m.title, m.startsAt.toISOString(), m.durationMinutes, m.timeZone]),
    ).toEqual([
      // Written in UTC, it keeps to UTC.
      ['In UTC', '2026-11-05T14:00:00.000Z', 30, 'UTC'],
      ['In New York', '2026-11-05T14:00:00.000Z', 45, 'America/New_York'],
      ['Floating', '2026-11-05T13:30:00.000Z', 60, 'Asia/Kolkata'],
    ]);
  });

  test('folded lines are unfolded and escaped text undone', () => {
    const { meetings: read } = parseCalendar(
      ics(
        event(
          'SUMMARY:Plan\\, review\\; ship',
          'DESCRIPTION:Line one\\nLine two that goes on and on and on past the fold po',
          ' int of seventy-five octets',
          'DTSTART:20261105T140000Z',
          'URL:https://meet.example.com/abc',
        ),
      ),
      'UTC',
    );
    expect(read[0]?.title).toBe('Plan, review; ship');
    expect(read[0]?.agenda).toBe(
      'Line one\nLine two that goes on and on and on past the fold point of seventy-five octets',
    );
    expect(read[0]?.joinUrl).toBe('https://meet.example.com/abc');
    expect(unescapeText('a\\\\b')).toBe('a\\b');
  });

  test('a weekly repeat by count or by end date, kept at local time across the change', () => {
    const { meetings: read } = parseCalendar(
      ics(
        event(
          'SUMMARY:By count',
          'DTSTART;TZID=America/New_York:20261022T090000',
          'DURATION:PT30M',
          'RRULE:FREQ=WEEKLY;COUNT=3',
        ),
        event(
          'SUMMARY:By end',
          'DTSTART;TZID=America/New_York:20261022T090000',
          'DURATION:PT30M',
          'RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261105T235959Z',
        ),
      ),
      'UTC',
    );
    for (const meeting of read) {
      expect(meeting.repeatCount).toBe(3);
      const local = occurrences(meeting).map((at) => wallOf(at, 'Asia/Kolkata'));
      expect(local.map((wall) => `${wall.hour}:${wall.minute}`)).toEqual([
        '18:30',
        '18:30',
        '19:30',
      ]);
    }
  });

  test('what cannot be taken is left out, each with a reason', () => {
    const { meetings: read, skipped } = parseCalendar(
      ics(
        event('SUMMARY:All day', 'DTSTART;VALUE=DATE:20261105'),
        event('SUMMARY:Daily', 'DTSTART:20261105T140000Z', 'RRULE:FREQ=DAILY;COUNT=5'),
        event('SUMMARY:Forever', 'DTSTART:20261105T140000Z', 'RRULE:FREQ=WEEKLY'),
        event('SUMMARY:Off', 'DTSTART:20261105T140000Z', 'STATUS:CANCELLED'),
        event('SUMMARY:Mars', 'DTSTART;TZID=Mars/Base:20261105T140000'),
        event('SUMMARY:Too short', 'DTSTART:20261105T140000Z', 'DURATION:PT5M'),
        event('SUMMARY:Fine', 'DTSTART:20261105T140000Z'),
      ),
      'UTC',
    );
    expect(read.map((m) => m.title)).toEqual(['Fine']);
    expect(skipped).toEqual([
      { title: 'All day', reason: 'an all-day event' },
      { title: 'Daily', reason: 'repeats other than once a week' },
      { title: 'Forever', reason: 'repeats with no end' },
      { title: 'Off', reason: 'it was cancelled' },
      { title: 'Mars', reason: 'a time zone this server does not know' },
      { title: 'Too short', reason: 'a length outside 15 minutes to a day' },
    ]);
  });

  test('more than fifty events: the rest are left out, and said so', () => {
    const many = Array.from({ length: 52 }, (_, i) =>
      event(`SUMMARY:Meeting ${i}`, 'DTSTART:20261105T140000Z'),
    );
    const { meetings: read, skipped, found } = parseCalendar(ics(...many), 'UTC');
    expect(found).toBe(52);
    expect(read).toHaveLength(50);
    expect(skipped).toEqual([{ title: null, reason: 'more than 50 events in one file' }]);
  });
});

describe('importing into a workspace', () => {
  async function team() {
    const ada = await createActor('Ada');
    const workspace = await createWorkspace(ada);
    const ben = await createActor('Ben', { email: `ben-${crypto.randomUUID()}@robis.test` });
    await addMember(ada, workspace.id, ben, 'MEMBER');
    const outsider = await createActor('Outsider');
    return { ada, ben, outsider, workspace };
  }

  const upload = (actor: Actor | undefined, workspaceId: string, body: string, zone = 'UTC') =>
    request(`/workspaces/${workspaceId}/meetings/import?timeZone=${encodeURIComponent(zone)}`, {
      method: 'POST',
      actor,
      payload: body,
      headers: { 'content-type': 'text/calendar' },
    });

  test('invitees are the attendees on the roster, matched by address; nobody else', async () => {
    const { ada, ben, outsider, workspace } = await team();
    const { ownerDb } = await getHarness();
    const benEmail = (await request('/auth/me', { actor: ben })).json().user.email as string;
    const outsiderEmail = (await request('/auth/me', { actor: outsider })).json().user
      .email as string;
    const reply = await upload(
      ada,
      workspace.id,
      ics(
        event(
          'SUMMARY:Planning',
          'DTSTART:20261205T140000Z',
          `ATTENDEE;CN=Ben:mailto:${benEmail.toUpperCase()}`,
          `ATTENDEE:mailto:${outsiderEmail}`,
          'ATTENDEE:mailto:nobody@nowhere.test',
        ),
      ),
    );
    expect(reply.statusCode).toBe(201);
    const body = reply.json();
    expect(body.created).toHaveLength(1);
    expect(body.created[0].invited).toBe(1);
    const attendees = await ownerDb
      .select({ userId: meetingAttendees.userId })
      .from(meetingAttendees)
      .where(eq(meetingAttendees.meetingId, body.created[0].id));
    expect(attendees.map((a) => a.userId).sort()).toEqual([ada.id, ben.id].sort());
  });

  test('a repeat imported in New York keeps its zone and count', async () => {
    const { ada, workspace } = await team();
    const reply = await upload(
      ada,
      workspace.id,
      ics(
        event(
          'SUMMARY:Stand-up',
          'DTSTART;TZID=America/New_York:20261022T090000',
          'DURATION:PT15M',
          'RRULE:FREQ=WEEKLY;COUNT=3',
        ),
      ),
    );
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select()
      .from(meetings)
      .where(eq(meetings.id, reply.json().created[0].id));
    expect(row?.timeZone).toBe('America/New_York');
    expect(row?.repeatCount).toBe(3);
    expect(row?.lastStartsAt.toISOString()).toBe('2026-11-05T14:00:00.000Z');
  });

  test('refusals: a guest 403, a stranger 404, an empty or eventless file 400', async () => {
    const { ada, outsider, workspace } = await team();
    const guest = await createActor('Guest');
    await addMember(ada, workspace.id, guest, 'GUEST');
    const file = ics(event('SUMMARY:x', 'DTSTART:20261205T140000Z'));
    expect((await upload(guest, workspace.id, file)).statusCode).toBe(403);
    expect((await upload(outsider, workspace.id, file)).statusCode).toBe(404);
    expect((await upload(undefined, workspace.id, file)).statusCode).toBe(401);
    expect((await upload(ada, workspace.id, ics())).statusCode).toBe(400);
  });

  test('a file over 256 KB is refused before it is read', async () => {
    const { ada, workspace } = await team();
    const huge = ics(
      event('SUMMARY:x', 'DTSTART:20261205T140000Z', `DESCRIPTION:${'a'.repeat(300 * 1024)}`),
    );
    expect((await upload(ada, workspace.id, huge)).statusCode).toBe(413);
  });
});

describe('what the review asked for', () => {
  test('a reminder inside an event lends it nothing', () => {
    const { meetings: read } = parseCalendar(
      ics(
        event(
          'SUMMARY:With a reminder',
          'DTSTART:20261205T140000Z',
          'BEGIN:VALARM',
          'ACTION:EMAIL',
          'DESCRIPTION:This is an event reminder',
          'DURATION:PT5M',
          'ATTENDEE:mailto:someone@robis.test',
          'END:VALARM',
        ),
      ),
      'UTC',
    );
    expect(read[0]).toMatchObject({ agenda: null, durationMinutes: 30, attendeeEmails: [] });
  });

  test('repeats with exceptions or other parts are left out, not guessed', () => {
    const { skipped } = parseCalendar(
      ics(
        event(
          'SUMMARY:Exception',
          'DTSTART:20261205T140000Z',
          'RRULE:FREQ=WEEKLY;COUNT=3',
          'EXDATE:20261212T140000Z',
        ),
        event('SUMMARY:January', 'DTSTART:20261205T140000Z', 'RRULE:FREQ=WEEKLY;BYMONTH=1;COUNT=3'),
        event(
          'SUMMARY:Backwards',
          'DTSTART:20261205T140000Z',
          'RRULE:FREQ=WEEKLY;UNTIL=20261101T000000Z',
        ),
        event('SUMMARY:Month 13', 'DTSTART:20261305T140000Z'),
      ),
      'UTC',
    );
    expect(skipped).toEqual([
      { title: 'Exception', reason: 'a repeat with exceptions' },
      { title: 'January', reason: 'repeats other than once a week' },
      { title: 'Backwards', reason: 'a repeat that ends before it starts' },
      { title: 'Month 13', reason: 'a time it could not read' },
    ]);
  });

  test('a repeat written in UTC keeps to UTC across a clock change, wherever it is imported', () => {
    const { meetings: read } = parseCalendar(
      ics(event('SUMMARY:UTC weekly', 'DTSTART:20261022T130000Z', 'RRULE:FREQ=WEEKLY;COUNT=3')),
      'America/New_York',
    );
    expect(occurrences(read[0]!).map((at) => at.toISOString())).toEqual([
      '2026-10-22T13:00:00.000Z',
      '2026-10-29T13:00:00.000Z',
      '2026-11-05T13:00:00.000Z',
    ]);
  });

  test('control characters stripped; an overlong link dropped', () => {
    const { meetings: read } = parseCalendar(
      ics(
        event(
          'SUMMARY:Null\u0000byte',
          'DTSTART:20261205T140000Z',
          `URL:https://example.com/${'a'.repeat(2100)}`,
        ),
      ),
      'UTC',
    );
    expect(read[0]?.title).toBe('Nullbyte');
    expect(read[0]?.joinUrl).toBeNull();
  });

  async function team() {
    const ada = await createActor('Ada');
    const workspace = await createWorkspace(ada);
    const ben = await createActor('Ben', { email: `ben-${crypto.randomUUID()}@robis.test` });
    await addMember(ada, workspace.id, ben, 'MEMBER');
    const cat = await createActor('Cat', { email: `cat-${crypto.randomUUID()}@robis.test` });
    await addMember(ada, workspace.id, cat, 'MEMBER');
    return { ada, ben, cat, workspace };
  }

  const upload = (actor: Actor, workspaceId: string, body: string, zone = 'UTC') =>
    request(`/workspaces/${workspaceId}/meetings/import?timeZone=${encodeURIComponent(zone)}`, {
      method: 'POST',
      actor,
      payload: body,
      headers: { 'content-type': 'text/calendar' },
    });

  test("a member's import adds nobody from the file, so it cannot ask whose address is whose", async () => {
    const { ben, cat, workspace } = await team();
    const catEmail = (await request('/auth/me', { actor: cat })).json().user.email as string;
    const reply = await upload(
      ben,
      workspace.id,
      ics(event('SUMMARY:Probe', 'DTSTART:20261205T140000Z', `ATTENDEE:mailto:${catEmail}`)),
    );
    expect(reply.statusCode).toBe(201);
    expect(reply.json().created[0].invited).toBe(0);
    expect(reply.json().attendeesLeftOff).toBe(true);
    const { ownerDb } = await getHarness();
    const attendees = await ownerDb
      .select({ userId: meetingAttendees.userId })
      .from(meetingAttendees)
      .where(eq(meetingAttendees.meetingId, reply.json().created[0].id));
    expect(attendees.map((a) => a.userId)).toEqual([ben.id]);
  });

  test('the same file twice brings nothing new; an unknown zone is refused', async () => {
    const { ada, workspace } = await team();
    const file = ics(event('SUMMARY:Once only', 'DTSTART:20261205T140000Z'));
    expect((await upload(ada, workspace.id, file)).json().created).toHaveLength(1);
    const again = (await upload(ada, workspace.id, file)).json();
    expect(again.created).toHaveLength(0);
    expect(again.skipped).toEqual([{ title: 'Once only', reason: 'it is already here' }]);
    expect((await upload(ada, workspace.id, file, 'Mars/Base')).statusCode).toBe(400);
  });
});
