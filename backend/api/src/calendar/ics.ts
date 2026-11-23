/**
 * An iCalendar file (RFC 5545) for a calendar feed (B8). Every occurrence
 * is its own event at a UTC instant, worked out in the meeting's own zone,
 * so a calendar app shows it at the right local time for whoever reads it
 * with no time-zone tables in the file and no repeat rules to misread.
 */

const CRLF = '\r\n';
/** Lines are folded at 75 octets; a continuation starts with one space. */
const FOLD_OCTETS = 75;

export type FeedEvent = {
  uid: string;
  start: Date;
  minutes: number;
  title: string;
  description: string;
  url: string | null;
  canceled: boolean;
  updatedAt: Date;
};

/** A UTC instant as iCalendar writes it: 20261105T140000Z. */
export function utcStamp(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** Text with the characters iCalendar reserves escaped. */
export function escapeText(text: string): string {
  return (
    text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      // Every kind of line break is a written \n: a bare CR, or a Unicode
      // separator, would otherwise start a new property for some readers.
      .replace(/\r\n|\r|\n|\u0085|\u2028|\u2029/g, '\\n')
      // Other control characters have no place in a calendar line.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
  );
}

/** One content line, folded so no physical line passes 75 octets. */
export function fold(line: string): string {
  const encoder = new TextEncoder();
  const pieces: string[] = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    // The first line has 75; each continuation 74, after its leading space.
    const limit = pieces.length === 0 ? FOLD_OCTETS : FOLD_OCTETS - 1;
    if (size + octets > limit) {
      pieces.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += octets;
  }
  pieces.push(current);
  return pieces.join(`${CRLF} `);
}

function eventLines(event: FeedEvent): string[] {
  const end = new Date(event.start.getTime() + event.minutes * 60_000);
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(event.updatedAt)}`,
    // Later edits win in the reader's calendar.
    `SEQUENCE:${Math.floor(event.updatedAt.getTime() / 1000)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeText(event.description)}`] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    `STATUS:${event.canceled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ];
}

/** The whole feed, CRLF-separated and folded, ready to serve. */
export function calendarFile(name: string, events: readonly FeedEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Robis//Calendar feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...events.flatMap(eventLines),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}
