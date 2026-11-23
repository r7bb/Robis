import {
  canonicalZone,
  instantOf,
  MEETING_MAX_MINUTES,
  MEETING_MIN_MINUTES,
  MEETING_REPEAT_MAX,
  occurrences,
  wallOf,
} from '@robis/shared';

/**
 * Reading an iCalendar file (RFC 5545) into meetings (B8). Only what is
 * tested is taken: timed events, at a UTC instant, in a named zone, or
 * floating (read in the importer's zone); an end or a duration; weekly
 * repeats with a count or an end. Anything else is skipped with a reason
 * rather than guessed at.
 */

/** One file brings at most this many meetings. */
export const IMPORT_EVENTS_MAX = 50;
const TITLE_MAX = 200;
const AGENDA_MAX = 5000;
const DEFAULT_TITLE = 'Imported meeting';

export type ImportedMeeting = {
  title: string;
  agenda: string | null;
  startsAt: Date;
  durationMinutes: number;
  timeZone: string;
  repeatCount: number | null;
  joinUrl: string | null;
  attendeeEmails: string[];
};

export type Skipped = { title: string | null; reason: string };

type Property = { name: string; params: Record<string, string>; value: string };

/** Content lines, unfolded: a line starting with a space or tab continues the last. */
function contentLines(text: string): string[] {
  return text
    .replace(/(?:\r\n|\r|\n)[ \t]/g, '')
    .split(/\r\n|\r|\n/)
    .filter((line) => line.length > 0);
}

/** NAME;PARAM=VALUE:value, with a colon inside a quoted parameter kept. */
function property(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon === -1) return null;
  const [name, ...rawParams] = line.slice(0, colon).split(';');
  const params = Object.fromEntries(
    rawParams.map((param) => {
      const equals = param.indexOf('=');
      return [param.slice(0, equals).toUpperCase(), param.slice(equals + 1).replace(/^"|"$/g, '')];
    }),
  );
  return { name: name!.toUpperCase(), params, value: line.slice(colon + 1) };
}

/**
 * Text fit to store: control characters (a NUL the database refuses among
 * them) removed, and cut to `max` characters without splitting one.
 */
function clean(text: string, max: number): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
  const kept = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return [...kept].slice(0, max).join('').trim();
}

/** Text with iCalendar's escapes undone. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN;,\\])/g, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  );
}

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
/** No meeting is imported from before this year or after the next century. */
const YEARS = { from: 1970, to: 2200 };

/** Whether a reading names a real moment: no month 13, no 25 o'clock, no 31 June. */
function realWall(wall: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}) {
  if (wall.year < YEARS.from || wall.year > YEARS.to || wall.hour > 23 || wall.minute > 59) {
    return false;
  }
  const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
  return day.getUTCMonth() === wall.month - 1 && day.getUTCDate() === wall.day;
}

/** A DTSTART or DTEND as an instant and the zone it was written in. */
function moment(prop: Property, fallbackZone: string): { at: Date; zone: string } | string {
  if (prop.params.VALUE === 'DATE' || /^\d{8}$/.test(prop.value)) return 'an all-day event';
  const match = DATE_TIME.exec(prop.value);
  if (!match) return 'a time it could not read';
  const [, y, mo, d, h, mi, , utc] = match;
  const wall = { year: +y!, month: +mo!, day: +d!, hour: +h!, minute: +mi! };
  if (!realWall(wall)) return 'a time it could not read';
  // Written in UTC: a repeat keeps to UTC, as the standard says.
  if (utc) {
    const at = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute));
    return { at, zone: 'UTC' };
  }
  const zone = prop.params.TZID ? canonicalZone(prop.params.TZID) : fallbackZone;
  if (!zone) return 'a time zone this server does not know';
  return { at: instantOf(wall, zone), zone };
}

const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/;

function durationMinutes(value: string): number | null {
  const match = DURATION.exec(value);
  if (!match) return null;
  const [, w, d, h, m] = match.map((part) => Number(part ?? 0));
  return (((w ?? 0) * 7 + (d ?? 0)) * 24 + (h ?? 0)) * 60 + (m ?? 0);
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const NOT_WEEKLY = 'repeats other than once a week';

/** The parts of a rule this reader understands; any other is a reason to skip. */
const RULE_PARTS: ReadonlySet<string> = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'COUNT',
  'UNTIL',
  'WKST',
]);

/** Whether a rule is plain "once a week, on the start's own day". */
function weeklyOnStartDay(parts: Record<string, string>, start: Date, zone: string): boolean {
  if (Object.keys(parts).some((key) => !RULE_PARTS.has(key))) return false;
  if (parts.COUNT && parts.UNTIL) return false;
  if (parts.FREQ !== 'WEEKLY' || (parts.INTERVAL && parts.INTERVAL !== '1')) return false;
  if (!parts.BYDAY) return true;
  const wall = wallOf(start, zone);
  return (
    parts.BYDAY === WEEKDAYS[new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()]
  );
}

/** How many weekly occurrences start by an UNTIL value, or why it cannot be read. */
function countUntil(until: string, start: Date, zone: string, minutes: number): number | string {
  const match = DATE_TIME.exec(until) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(until);
  if (!match) return 'a repeat end it could not read';
  const end = Date.UTC(
    +match[1]!,
    +match[2]! - 1,
    +match[3]!,
    +(match[4] ?? 23),
    +(match[5] ?? 59),
  );
  const all = occurrences({
    startsAt: start,
    durationMinutes: minutes,
    timeZone: zone,
    repeatCount: MEETING_REPEAT_MAX + 1,
  });
  const count = all.filter((at) => at.getTime() <= end).length;
  return count === 0 ? 'a repeat that ends before it starts' : count;
}

/** A weekly repeat's count, null for none, or why it cannot be taken. */
function repeatOf(
  rule: string | undefined,
  start: Date,
  zone: string,
  minutes: number,
): number | null | string {
  if (!rule) return null;
  const parts = Object.fromEntries(
    rule.split(';').map((part) => part.split('=') as [string, string]),
  );
  if (!weeklyOnStartDay(parts, start, zone)) return NOT_WEEKLY;
  if (!parts.COUNT && !parts.UNTIL) return 'repeats with no end';
  const count = parts.COUNT ? Number(parts.COUNT) : countUntil(parts.UNTIL!, start, zone, minutes);
  if (typeof count === 'string') return count;
  if (!Number.isInteger(count) || count < 1) return 'a repeat it could not read';
  if (count > MEETING_REPEAT_MAX) return `repeats more than ${MEETING_REPEAT_MAX} times`;
  return count === 1 ? null : count;
}

const HTTPS = /^https:\/\/\S+$/i;
/** As long a join link as scheduling takes. */
const JOIN_URL_MAX = 2000;
type Lookup = (name: string) => Property | undefined;

/** The meeting's length in minutes, from its end or duration, or why not. */
function lengthOf(get: Lookup, start: { at: Date; zone: string }): number | string {
  const endProp = get('DTEND');
  const durationProp = get('DURATION');
  let minutes: number | null = MEETING_MIN_MINUTES * 2;
  if (endProp) {
    const end = moment(endProp, start.zone);
    if (typeof end === 'string') return end;
    minutes = Math.round((end.at.getTime() - start.at.getTime()) / 60_000);
  } else if (durationProp) minutes = durationMinutes(durationProp.value);
  if (minutes === null || minutes < MEETING_MIN_MINUTES || minutes > MEETING_MAX_MINUTES) {
    return `a length outside ${MEETING_MIN_MINUTES} minutes to a day`;
  }
  return minutes;
}

/** Why an event is not a meeting to import, before its times are read; null if it may be. */
function refusal(get: Lookup): string | null {
  if (get('RECURRENCE-ID')) return 'a change to one occurrence of a repeat';
  if (get('EXDATE') || get('RDATE') || get('EXRULE')) return 'a repeat with exceptions';
  if (get('STATUS')?.value.toUpperCase() === 'CANCELLED') return 'it was cancelled';
  if (!get('DTSTART')) return 'no start time';
  return null;
}

/** One VEVENT's properties, as a meeting, or why it was left out. */
function meetingOf(props: Property[], fallbackZone: string): ImportedMeeting | Skipped {
  const get: Lookup = (name) => props.find((prop) => prop.name === name);
  const summary = get('SUMMARY');
  const title = (summary ? clean(unescapeText(summary.value), TITLE_MAX) : '') || DEFAULT_TITLE;
  const skip = (reason: string): Skipped => ({ title, reason });

  const refused = refusal(get);
  if (refused) return skip(refused);
  const start = moment(get('DTSTART')!, fallbackZone);
  if (typeof start === 'string') return skip(start);
  const minutes = lengthOf(get, start);
  if (typeof minutes === 'string') return skip(minutes);
  const repeat = repeatOf(get('RRULE')?.value, start.at, start.zone, minutes);
  if (typeof repeat === 'string') return skip(repeat);

  const description = get('DESCRIPTION');
  const link = [get('URL')?.value, get('LOCATION')?.value]
    .map((value) => (value === undefined ? '' : unescapeText(value).trim()))
    .find((value) => value.length <= JOIN_URL_MAX && HTTPS.test(value));
  return {
    title,
    agenda: description ? clean(unescapeText(description.value), AGENDA_MAX) || null : null,
    startsAt: start.at,
    durationMinutes: minutes,
    timeZone: start.zone,
    repeatCount: repeat,
    joinUrl: link ?? null,
    attendeeEmails: props
      .filter((prop) => prop.name === 'ATTENDEE' && /^mailto:/i.test(prop.value))
      .map((prop) => prop.value.slice('mailto:'.length).trim().toLowerCase()),
  };
}

/**
 * Reading state: the events so far, the one being read, and how deep in
 * its own parts (a reminder, say) the reader is. Only an event's own
 * lines, at depth 0, are the event's.
 */
type Reading = { events: Property[][]; current: Property[] | null; depth: number };

/** One line's effect on the reading: the arrays are this reader's own. */
function step(state: Reading, prop: Property): Reading {
  if (!state.current) {
    const opens = prop.name === 'BEGIN' && prop.value.toUpperCase() === 'VEVENT';
    return opens ? { ...state, current: [], depth: 0 } : state;
  }
  if (prop.name === 'BEGIN') return { ...state, depth: state.depth + 1 };
  if (prop.name === 'END' && state.depth > 0) return { ...state, depth: state.depth - 1 };
  if (prop.name === 'END') {
    state.events.push(state.current);
    return { ...state, current: null };
  }
  if (state.depth === 0) state.current.push(prop);
  return state;
}

/** The file's events, each as its list of properties. */
function eventsOf(text: string): Property[][] {
  let state: Reading = { events: [], current: null, depth: 0 };
  for (const prop of contentLines(text).map(property)) {
    if (prop) state = step(state, prop);
  }
  return state.events;
}

/** Every event in a file: the meetings it holds, and what was left out and why. */
export function parseCalendar(text: string, fallbackZone: string) {
  const events = eventsOf(text);
  const meetings: ImportedMeeting[] = [];
  const skipped: Skipped[] = [];
  for (const props of events.slice(0, IMPORT_EVENTS_MAX)) {
    const result = meetingOf(props, fallbackZone);
    if ('reason' in result) skipped.push(result);
    else meetings.push(result);
  }
  if (events.length > IMPORT_EVENTS_MAX) {
    skipped.push({ title: null, reason: `more than ${IMPORT_EVENTS_MAX} events in one file` });
  }
  return { meetings, skipped, found: events.length };
}
