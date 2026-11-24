import type { IssuePriority, IssueStatus } from './domain.ts';
import { parseWhen } from './when.ts';

/**
 * Sapha, tier 0: a plain request ("move REL-4 to done", "remind me about
 * REL-12 tomorrow 9am", "what's due today") read into one intent, with no
 * model and nothing sent anywhere. What it cannot read is null, and the
 * palette carries on searching. An intent that changes anything is only
 * proposed: the page says what it will do (`describeIntent`) and waits for
 * a yes, then does it as the person, through the routes they already use.
 */

export type SaphaPlace = 'day' | 'calendar' | 'feed' | 'spaces' | 'meetings';

export type SaphaIntent =
  | { kind: 'status'; issueKey: string; status: IssueStatus }
  | { kind: 'priority'; issueKey: string; priority: IssuePriority }
  | { kind: 'assign'; issueKey: string; person: string }
  | { kind: 'unassign'; issueKey: string }
  | { kind: 'due'; issueKey: string; dueOn: string | null }
  | { kind: 'create'; title: string; board: string | null }
  | { kind: 'remind'; issueKey: string; at: Date }
  | { kind: 'schedule'; title: string; at: Date }
  | { kind: 'open'; issueKey: string }
  | { kind: 'search'; query: string }
  | { kind: 'go'; place: SaphaPlace };

/** Intents that only look or go somewhere; every other kind needs a yes. */
export const LOOKING_INTENTS: ReadonlySet<SaphaIntent['kind']> = new Set(['open', 'search', 'go']);

const KEY = '([a-z][a-z0-9]{0,9}-\\d{1,9})';
const STATUS_WORDS: [RegExp, IssueStatus][] = [
  [/^(done|finished|complete|completed|closed)$/, 'DONE'],
  [/^(in progress|doing|started)$/, 'IN_PROGRESS'],
  [/^(in review|review|reviewing)$/, 'IN_REVIEW'],
  [/^(to ?do|not started)$/, 'TODO'],
  [/^(canceled|cancelled)$/, 'CANCELED'],
];
const STATUS_VERBS: Record<string, IssueStatus> = {
  cancel: 'CANCELED',
  close: 'DONE',
  finish: 'DONE',
  complete: 'DONE',
  start: 'IN_PROGRESS',
};
const PRIORITIES: Record<string, IssuePriority> = {
  urgent: 'URGENT',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  none: 'NONE',
};
const PLACES: [RegExp, SaphaPlace][] = [
  [/^(what'?s|what is) due( today)?$|^(my )?day$|^today$|^what do i have( today)?$/, 'day'],
  [/^(the |my )?calendar$/, 'calendar'],
  [/^(who'?s|who is) (here|around|on)$|^(the )?feed$|^what'?s new$/, 'feed'],
  [/^spaces$/, 'spaces'],
  [/^(my )?meetings$/, 'meetings'],
];

/** The request without greetings, her name, politeness or end punctuation. */
function normalise(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, '')
    .replace(/^(hey |hi |ok |okay )?sapha[,:]?\s*/, '')
    .replace(/^(please |can you |could you |would you )+/, '')
    .replace(/,?\s*please$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const key = (raw: string) => raw.toUpperCase();

/** A piece of the lower-cased request as it was typed, its capitals kept. */
function asTyped(request: string, piece: string): string {
  const spaced = request.replace(/\s+/g, ' ');
  const start = spaced.toLowerCase().lastIndexOf(piece);
  return start >= 0 ? spaced.slice(start, start + piece.length) : piece;
}

function statusOf(words: string): IssueStatus | null {
  return STATUS_WORDS.find(([pattern]) => pattern.test(words))?.[1] ?? null;
}

/** A local calendar day, as a due day is kept: "2026-11-27". */
function dayOf(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/** The words before a time, and the time: the shortest title whose rest reads as one. */
function titleThenTime(words: string, now: Date): { title: string; at: Date } | null {
  const tokens = words.split(' ');
  for (let split = 1; split < tokens.length; split++) {
    const at = parseWhen(
      tokens
        .slice(split)
        .join(' ')
        .replace(/^(on|at|for) /, ''),
      now,
    );
    if (at) return { title: tokens.slice(0, split).join(' '), at };
  }
  return null;
}

function issueChange(text: string, request: string, now: Date): SaphaIntent | null {
  let m = new RegExp(
    `^(?:make|set|mark) ${KEY} (?:priority )?(?:to |as )?(urgent|high|medium|low|none)(?: priority)?$`,
  ).exec(text);
  if (m) return { kind: 'priority', issueKey: key(m[1]!), priority: PRIORITIES[m[2]!]! };
  m = new RegExp(`^(?:move|mark|set|put) ${KEY} (?:to |as |into |in )?(.+)$`).exec(text);
  if (m && statusOf(m[2]!))
    return { kind: 'status', issueKey: key(m[1]!), status: statusOf(m[2]!)! };
  m = new RegExp(`^${KEY} (?:is |to )(.+)$`).exec(text);
  if (m && statusOf(m[2]!))
    return { kind: 'status', issueKey: key(m[1]!), status: statusOf(m[2]!)! };
  m = new RegExp(`^(cancel|close|finish|complete|start) ${KEY}$`).exec(text);
  if (m) return { kind: 'status', issueKey: key(m[2]!), status: STATUS_VERBS[m[1]!]! };
  m = new RegExp(`^(?:assign|give|hand) ${KEY} to (.+)$`).exec(text);
  if (m) {
    const person = m[2] === 'me' ? 'me' : asTyped(request, m[2]!);
    return { kind: 'assign', issueKey: key(m[1]!), person };
  }
  m = new RegExp(`^unassign ${KEY}$`).exec(text);
  if (m) return { kind: 'unassign', issueKey: key(m[1]!) };
  m = new RegExp(`^(?:clear|remove) the due (?:date|day) (?:on|of|from) ${KEY}$`).exec(text);
  if (m) return { kind: 'due', issueKey: key(m[1]!), dueOn: null };
  m = new RegExp(`^(?:set |make )?${KEY} (?:is )?due (?:on )?(.+)$`).exec(text);
  if (m) {
    const when = parseWhen(m[2]!, now);
    return when ? { kind: 'due', issueKey: key(m[1]!), dueOn: dayOf(when) } : null;
  }
  return null;
}

function making(text: string, original: string, now: Date): SaphaIntent | null {
  let m = new RegExp(`^remind me (?:about |of |to look at )?${KEY} (.+)$`).exec(text);
  if (m) {
    const at = parseWhen(m[2]!, now);
    return at ? { kind: 'remind', issueKey: key(m[1]!), at } : null;
  }
  m = /^(?:schedule|book)(?: a meeting| meeting)?(?: called| named)? (.+)$/.exec(text);
  if (m) {
    const found = titleThenTime(m[1]!, now);
    if (!found) return null;
    const title = asTyped(original, found.title).replace(/^["“]|["”]$/g, '');
    return { kind: 'schedule', title, at: found.at };
  }
  // A new issue: its title as typed, and a board only after a quoted title.
  m = /^(?:new|create|add|file)(?: an?)? issue:? (.+)$/i.exec(
    original.trim().replace(/^(hey |hi |ok )?sapha[,:]?\s*/i, ''),
  );
  if (m) {
    const rest = m[1]!.trim();
    const quoted = /^["“](.+?)["”](?:\s+(?:on|in)\s+(?:the\s+)?(.+?)(?:\s+board)?)?$/.exec(rest);
    if (quoted) return { kind: 'create', title: quoted[1]!, board: quoted[2] ?? null };
    return { kind: 'create', title: rest.replace(/[.!]+$/, ''), board: null };
  }
  return null;
}

function looking(text: string, request: string): SaphaIntent | null {
  let m = new RegExp(`^(?:open |show |go to )?${KEY}$`).exec(text);
  if (m) return { kind: 'open', issueKey: key(m[1]!) };
  m = /^(?:find|search(?: for)?|look for|look up) (.+)$/.exec(text);
  if (m) return { kind: 'search', query: asTyped(request, m[1]!) };
  const place = text.replace(/^(show( me)?|go to|open|take me to) (the |my )?/, '');
  for (const [pattern, name] of PLACES) {
    if (pattern.test(text) || pattern.test(place)) return { kind: 'go', place: name };
  }
  return null;
}

/** What a request asks for, or null when it is not one Sapha reads. */
export function interpret(request: string, now: Date = new Date()): SaphaIntent | null {
  const text = normalise(request);
  if (!text) return null;
  return issueChange(text, request, now) ?? making(text, request, now) ?? looking(text, request);
}

const STATUS_NAMES: Record<IssueStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELED: 'Canceled',
};
const PLACE_LINES: Record<SaphaPlace, string> = {
  day: 'Show your day',
  calendar: 'Show the calendar',
  feed: 'Show who is here',
  spaces: 'Go to Spaces',
  meetings: 'Show meetings',
};
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 27 Nov", and "Fri 27 Nov 15:00" with the time. */
function dateLine(when: Date, withTime: boolean): string {
  const day = `${WEEKDAY[when.getDay()]} ${when.getDate()} ${MONTH[when.getMonth()]}`;
  if (!withTime) return day;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** What Sapha will do, in a sentence a person checks before saying yes. */
export function describeIntent(intent: SaphaIntent, _now: Date = new Date()): string {
  switch (intent.kind) {
    case 'status':
      return `Move ${intent.issueKey} to ${STATUS_NAMES[intent.status]}`;
    case 'priority':
      return `Make ${intent.issueKey} ${capital(intent.priority)} priority`;
    case 'assign':
      return `Give ${intent.issueKey} to ${intent.person === 'me' ? 'you' : intent.person}`;
    case 'unassign':
      return `Unassign ${intent.issueKey}`;
    case 'due':
      return intent.dueOn
        ? `Make ${intent.issueKey} due ${dateLine(new Date(`${intent.dueOn}T12:00`), false)}`
        : `Clear the due date on ${intent.issueKey}`;
    case 'create':
      return `Create the issue “${intent.title}”${intent.board ? ` on ${intent.board}` : ''}`;
    case 'remind':
      return `Remind you about ${intent.issueKey}, ${dateLine(intent.at, true)}`;
    case 'schedule':
      return `Schedule “${intent.title}”, ${dateLine(intent.at, true)}`;
    case 'open':
      return `Open ${intent.issueKey}`;
    case 'search':
      return `Search for “${intent.query}”`;
    case 'go':
      return PLACE_LINES[intent.place];
  }
}
