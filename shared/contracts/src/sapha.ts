import { z } from 'zod';
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
  /** A question: what an issue waits on, answered in the palette. */
  | { kind: 'blockers'; issueKey: string }
  /** A question: who has an issue and how it stands, answered in the palette. */
  | { kind: 'about'; issueKey: string }
  /** How the cycle running now is going, on one board when named. */
  | { kind: 'cycle'; board: string | null }
  /** How a release is going: the one named, else the next to ship. */
  | { kind: 'release'; name: string | null }
  | { kind: 'search'; query: string }
  | { kind: 'go'; place: SaphaPlace };

/** Intents that only look or go somewhere; every other kind needs a yes. */
export const LOOKING_INTENTS: ReadonlySet<SaphaIntent['kind']> = new Set([
  'open',
  'search',
  'go',
  'blockers',
  'about',
  'cycle',
  'release',
]);

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

const CYCLE = '(?:cycle|sprint)';
const CYCLE_QUESTION = new RegExp(
  `^(?:how(?:'s| is) (?:the |this |our |my )?(?:current )?${CYCLE}(?: going| doing| looking)?|(?:what(?:'s| is) )?left in (?:the |this |our )?${CYCLE}|(?:the )?${CYCLE} (?:progress|status))(?: (?:on|for|in) (?:the )?(.+?))?(?: board)?$`,
);

// A release is named only in a question's own shape ("how is release X
// going", "release status for X"), so ordinary words about releases stay
// searches.
const RELEASE_QUESTION = new RegExp(
  [
    "^how(?:'s| is) (?:the |our )?(?:next )?release(?: going| doing| looking)?$",
    "^how(?:'s| is) release (.+?) (?:going|doing|looking)$",
    "^(?:what(?:'s| is) )?left (?:in|for) (?:the |our )?(?:next )?release(?: (.+))?$",
    '^(?:the )?release (?:progress|status)(?: for (.+))?$',
  ].join('|'),
);

/** Words after "for" that mean the asker's own boards, not one named. */
const EVERY_BOARD = /^(?:me|us|my team|our team|the team|everyone)$/;

/** A question about how a release or the cycle is going, or null. */
function planQuestion(text: string, request: string): SaphaIntent | null {
  const release = RELEASE_QUESTION.exec(text);
  if (release) {
    const named = release[1] ?? release[2] ?? release[3];
    return { kind: 'release', name: named ? asTyped(request, named) : null };
  }
  const cycle = CYCLE_QUESTION.exec(text);
  if (!cycle) return null;
  const board = cycle[1] && !EVERY_BOARD.test(cycle[1]) ? asTyped(request, cycle[1]) : null;
  return { kind: 'cycle', board };
}

function looking(text: string, request: string): SaphaIntent | null {
  const plan = planQuestion(text, request);
  if (plan) return plan;
  let m = new RegExp(
    `^(?:what(?:'s| is| are)|who(?:'s| is)) (?:blocking|holding up|in the way of) ${KEY}$`,
  ).exec(text);
  if (m) return { kind: 'blockers', issueKey: key(m[1]!) };
  m = new RegExp(`^(?:what (?:does|is) )?${KEY} (?:wait(?:ing)? on|blocked by)$`).exec(text);
  if (m) return { kind: 'blockers', issueKey: key(m[1]!) };
  m = new RegExp(
    `^(?:who(?:'s| is) (?:on|working on|doing|assigned(?: to)?)|who has|(?:what(?:'s| is) )?(?:the )?status of|how(?:'s| is)|tell me about|what about) ${KEY}(?: going| doing)?$`,
  ).exec(text);
  if (m) return { kind: 'about', issueKey: key(m[1]!) };
  m = new RegExp(`^(?:open |show |go to )?${KEY}$`).exec(text);
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
    case 'blockers':
      return `What ${intent.issueKey} waits on`;
    case 'about':
      return `How ${intent.issueKey} stands`;
    case 'cycle':
      return intent.board
        ? `How the cycle on ${intent.board} is going`
        : 'How the cycles are going';
    case 'release':
      return intent.name ? `How ${intent.name} is going` : 'How the next release is going';
    case 'search':
      return `Search for “${intent.query}”`;
    case 'go':
      return PLACE_LINES[intent.place];
  }
}

/** The kinds of request the provider may answer with; `none` when it is none of them. */
export const SAPHA_KINDS = [
  'status',
  'priority',
  'assign',
  'unassign',
  'due',
  'create',
  'remind',
  'schedule',
  'open',
  'blockers',
  'about',
  'cycle',
  'release',
  'search',
  'go',
  'none',
] as const;
const SAPHA_PLACES = ['day', 'calendar', 'feed', 'spaces', 'meetings'] as const;
const ISSUE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,9}-\d{1,9}$/;

/**
 * Sapha, tier 1: a request tier 0 cannot read, read by the optional
 * provider into these parts, and nothing else. A time comes back in the
 * words it was said in, and is read here on the person's own clock, so the
 * provider never decides a date; every part is checked by `intentFromParts`.
 */
export const saphaPartsSchema = z.object({
  kind: z.enum(SAPHA_KINDS),
  issueKey: z.string().nullable(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED']).nullable(),
  priority: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']).nullable(),
  /** A person's name as said, or "me". */
  person: z.string().nullable(),
  /** A new issue's or meeting's title. */
  title: z.string().nullable(),
  board: z.string().nullable(),
  /** When, in words: "tomorrow 9am", "friday", "in 2 hours". */
  when: z.string().nullable(),
  query: z.string().nullable(),
  place: z.enum(SAPHA_PLACES).nullable(),
});
export type SaphaParts = z.infer<typeof saphaPartsSchema>;

/** Text from the provider, trimmed and bounded, or null when empty. */
function words(text: string | null, max: number): string | null {
  const trimmed = text?.trim().replace(/\s+/g, ' ').slice(0, max) ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function keyOf(parts: SaphaParts): string | null {
  const key = parts.issueKey?.trim() ?? '';
  return ISSUE_KEY_PATTERN.test(key) ? key.toUpperCase() : null;
}

/** An issue change, when the parts name a real key and what to change. */
function issueIntent(parts: SaphaParts, issueKey: string, now: Date): SaphaIntent | null {
  switch (parts.kind) {
    case 'status':
      return parts.status ? { kind: 'status', issueKey, status: parts.status } : null;
    case 'priority':
      return parts.priority ? { kind: 'priority', issueKey, priority: parts.priority } : null;
    case 'assign': {
      const person = words(parts.person, 80);
      return person ? { kind: 'assign', issueKey, person } : null;
    }
    case 'unassign':
      return { kind: 'unassign', issueKey };
    case 'due': {
      if (!parts.when) return { kind: 'due', issueKey, dueOn: null };
      const when = parseWhen(parts.when, now);
      return when ? { kind: 'due', issueKey, dueOn: dayOf(when) } : null;
    }
    case 'remind': {
      const at = parts.when ? parseWhen(parts.when, now) : null;
      return at ? { kind: 'remind', issueKey, at } : null;
    }
    case 'open':
      return { kind: 'open', issueKey };
    case 'blockers':
      return { kind: 'blockers', issueKey };
    case 'about':
      return { kind: 'about', issueKey };
    default:
      return null;
  }
}

/** An intent from the provider's parts, checked as tier 0's are; null when they do not hold. */
export function intentFromParts(parts: SaphaParts, now: Date = new Date()): SaphaIntent | null {
  const issueKey = keyOf(parts);
  if (issueKey) {
    const change = issueIntent(parts, issueKey, now);
    if (change) return change;
  }
  switch (parts.kind) {
    case 'create': {
      const title = words(parts.title, 200);
      return title ? { kind: 'create', title, board: words(parts.board, 80) } : null;
    }
    case 'schedule': {
      const title = words(parts.title, 200);
      const at = parts.when ? parseWhen(parts.when, now) : null;
      return title && at ? { kind: 'schedule', title, at } : null;
    }
    case 'search': {
      const query = words(parts.query, 200);
      return query ? { kind: 'search', query } : null;
    }
    case 'go':
      return parts.place ? { kind: 'go', place: parts.place } : null;
    case 'cycle':
      return { kind: 'cycle', board: words(parts.board, 80) };
    case 'release':
      return { kind: 'release', name: words(parts.title, 80) };
    default:
      return null;
  }
}
