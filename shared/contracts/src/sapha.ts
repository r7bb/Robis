import { z } from 'zod';
import type { IssuePriority, IssueStatus } from './domain.ts';
import { CYCLE_DAYS_MAX } from './http/cycles.ts';
import { PROJECT_TEMPLATES, type ProjectTemplate, TEMPLATE_DETAILS } from './project-templates.ts';
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
  /** Put an issue in its board's current cycle or a named one, or the next release or a named one. */
  | { kind: 'plan'; issueKey: string; into: 'cycle' | 'release'; name: string | null }
  /** Plan a cycle of so many days from today, on a board. */
  | { kind: 'newCycle'; days: number; board: string | null }
  /** Plan a release by name, aimed at a day or none. */
  | { kind: 'newRelease'; name: string; targetOn: string | null }
  /** Make a board by name, empty or with a built-in template's starter issues. */
  | { kind: 'newBoard'; name: string; template: ProjectTemplate | null }
  /** Take an issue out of its cycle or release. */
  | { kind: 'unplan'; issueKey: string; from: 'cycle' | 'release' }
  /** A new issue from a template, by the template's name, with its own title or one given. */
  | { kind: 'template'; template: string; title: string | null; board: string | null }
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

const PLAN_INTO = new RegExp(
  `^(?:put|add|move|plan) ${KEY} (?:in|into|to|for) (?:the )?(?:(?:current|this|next) )?(cycle|sprint|release)(?: (.+))?$`,
);
const PLAN_OUT = new RegExp(
  `^(?:take|remove|drop) ${KEY} (?:out of|from) (?:the |its )?(cycle|sprint|release)$`,
);

const COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
};
/** A cycle is two weeks unless said otherwise. */
const CYCLE_DAYS_DEFAULT = 14;
const NEW_CYCLE =
  /^(?:plan|start|create) (?:a |an )?(?:(\d+|one|two|three|four|five|six|seven|eight)[- ](day|week) )?(?:cycle|sprint)(?: on (?:the )?(.+?)(?: board)?)?$/;
const NEW_RELEASE =
  /^(?:plan|create) (?:a |the )?(?:new )?release (?:called |named )?(.+?)(?: (for|on|due) (.+))?$/;

/** A new cycle of so many days; null when the words are not that. */
function newCycle(text: string, request: string): SaphaIntent | null {
  const cycle = NEW_CYCLE.exec(text);
  if (!cycle) return null;
  const count = cycle[1] ? (COUNTS[cycle[1]] ?? Number(cycle[1])) : null;
  const days = count === null ? CYCLE_DAYS_DEFAULT : count * (cycle[2] === 'week' ? 7 : 1);
  if (days < 1 || days > CYCLE_DAYS_MAX) return null;
  return { kind: 'newCycle', days, board: cycle[3] ? asTyped(request, cycle[3]) : null };
}

/**
 * A new release by name, with its day when the words after "for" read as
 * one ("Launch for customers" is all name); null when the words are not that.
 */
function newRelease(text: string, request: string, now: Date): SaphaIntent | null {
  const release = NEW_RELEASE.exec(text);
  if (!release || NOT_A_RELEASE.has(release[1]!)) return null;
  const when = release[3] ? parseWhen(release[3], now) : null;
  if (when) {
    return { kind: 'newRelease', name: asTyped(request, release[1]!), targetOn: dayOf(when) };
  }
  const said = release[3] ? `${release[1]} ${release[2]} ${release[3]}` : release[1]!;
  return { kind: 'newRelease', name: asTyped(request, said), targetOn: null };
}

/** Words that follow "release" in ordinary talk, never a release's name. */
const NOT_A_RELEASE = new Set(['notes', 'note', 'candidate', 'candidates', 'checklist']);

const NEW_BOARD =
  /^(?:create|make|start|add|new)(?: a| an)?(?: new)? (?:board|project)(?: called| named)? (.+)$/;
/** A quoted name, and a template after it when one is said. */
const QUOTED_BOARD =
  /^["“](.+?)["”](?:\s+(?:from|with|using)\s+(?:the\s+)?(.+?)(?:\s+template)?)?$/i;
/** A template said at the end of an unquoted name. */
const BOARD_TEMPLATE_TAIL = /^(.+?)\s+(?:from|with|using)\s+(?:the\s+)?(.+?)(?:\s+template)?$/i;
/** The longest board name the API takes. */
const BOARD_NAME_MAX = 80;

/** First words that make the rest ordinary talk, never a board's name. */
const NOT_A_BOARD = new Set([
  'plan',
  'plans',
  'brief',
  'update',
  'updates',
  'report',
  'proposal',
  'timeline',
  'roadmap',
  'review',
  'template',
  'templates',
  'on',
  'for',
  'in',
  'from',
  'with',
  'using',
  'called',
  'named',
]);

/** A built-in template by its id or its label, any case; null when none is. */
function builtInTemplate(said: string): ProjectTemplate | null {
  const words = said.trim().toLowerCase();
  return (
    PROJECT_TEMPLATES.find(
      (id) => id === words || TEMPLATE_DETAILS[id].label.toLowerCase() === words,
    ) ?? null
  );
}

/** A board name a person would mean, within what the API takes; null when it is not. */
function boardName(said: string): string | null {
  const name = said.trim();
  const first = name.split(/\s+/)[0]!.toLowerCase();
  if (!name || name.length > BOARD_NAME_MAX || NOT_A_BOARD.has(first)) return null;
  return name;
}

/** The name and template from the words after "board", as typed; null when they do not hold. */
function boardParts(rest: string): SaphaIntent | null {
  const quoted = QUOTED_BOARD.exec(rest);
  if (quoted) {
    const template = quoted[2] ? builtInTemplate(quoted[2]) : null;
    const name = quoted[1]!.trim();
    if ((quoted[2] && !template) || !name || name.length > BOARD_NAME_MAX) return null;
    return { kind: 'newBoard', name, template };
  }
  // A tail names a template only when it is a built-in one; else it is part of the name.
  const tail = BOARD_TEMPLATE_TAIL.exec(rest);
  const template = tail ? builtInTemplate(tail[2]!) : null;
  if (tail && template) {
    const name = boardName(tail[1]!);
    return name ? { kind: 'newBoard', name, template } : null;
  }
  if (/\stemplate$/i.test(rest)) return null;
  const name = boardName(rest);
  return name ? { kind: 'newBoard', name, template: null } : null;
}

/**
 * "Create a board called Summer party from the event template": the name as
 * typed, and a built-in template when one is named. A template that is not
 * built in leaves the whole request alone rather than folding it into a name.
 */
function newBoard(text: string, request: string): SaphaIntent | null {
  const m = NEW_BOARD.exec(text);
  return m ? boardParts(asTyped(request, m[1]!)) : null;
}

/** Into a cycle or release, or out of one; null when the words are not that. */
function planning(text: string, request: string): SaphaIntent | null {
  const into = PLAN_INTO.exec(text);
  if (into && !(into[2] === 'release' && NOT_A_RELEASE.has(into[3] ?? ''))) {
    return {
      kind: 'plan',
      issueKey: key(into[1]!),
      into: into[2] === 'release' ? 'release' : 'cycle',
      name: into[3] ? asTyped(request, into[3]) : null,
    };
  }
  const out = PLAN_OUT.exec(text);
  if (!out) return null;
  return {
    kind: 'unplan',
    issueKey: key(out[1]!),
    from: out[2] === 'release' ? 'release' : 'cycle',
  };
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
  m = /^(?:new|create|add|file)(?: an?)? issue:? (.+)$/i.exec(asSaid(original));
  if (m) {
    const { title, board } = titleAndBoard(m[1]!);
    return { kind: 'create', title, board };
  }
  return null;
}

/** The request as typed, without a greeting to Sapha. */
const asSaid = (original: string) => original.trim().replace(/^(hey |hi |ok )?sapha[,:]?\s*/i, '');

/** A title as typed; a board only after a quoted one ("Tidy settings" on Web). */
function titleAndBoard(rest: string): { title: string; board: string | null } {
  const trimmed = rest.trim();
  const quoted = /^["“](.+?)["”](?:\s+(?:on|in)\s+(?:the\s+)?(.+?)(?:\s+board)?)?$/.exec(trimmed);
  if (quoted) return { title: quoted[1]!, board: quoted[2] ?? null };
  return { title: trimmed.replace(/[.!]+$/, ''), board: null };
}

const TEMPLATE_REQUEST =
  /^(?:use|file from|file with|from) (?:the )?(.+?) template(?:(?: for|:) ?(.+))?$/;

/** Words that are never a template's name, only how one is spoken of. */
const NOT_A_TEMPLATE = new Set(['the', 'a', 'an', 'this', 'that']);

/**
 * "Use the bug report template for Login loops": the template by name, and
 * the title. Read on the tidied words, as the other readers are, with the
 * names put back as typed.
 */
function fromTemplate(text: string, request: string): SaphaIntent | null {
  const m = TEMPLATE_REQUEST.exec(text);
  if (!m || NOT_A_TEMPLATE.has(m[1]!)) return null;
  const template = asTyped(request, m[1]!);
  if (!m[2]?.trim()) return { kind: 'template', template, title: null, board: null };
  return { kind: 'template', template, ...titleAndBoard(asTyped(request, m[2])) };
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
  return (
    planning(text, request) ??
    newCycle(text, request) ??
    newRelease(text, request, now) ??
    newBoard(text, request) ??
    issueChange(text, request, now) ??
    fromTemplate(text, request) ??
    making(text, request, now) ??
    looking(text, request)
  );
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

/** A new issue, or an issue put in or taken out of a cycle or release, in a sentence. */
function describeMaking(
  intent: Extract<
    SaphaIntent,
    { kind: 'create' | 'plan' | 'unplan' | 'template' | 'newCycle' | 'newRelease' }
  >,
): string {
  const on = 'board' in intent && intent.board ? ` on ${intent.board}` : '';
  switch (intent.kind) {
    case 'create':
      return `Create the issue “${intent.title}”${on}`;
    case 'plan':
      return `Put ${intent.issueKey} in ${
        intent.name ?? (intent.into === 'cycle' ? 'the current cycle' : 'the next release')
      }`;
    case 'unplan':
      return `Take ${intent.issueKey} out of its ${intent.from}`;
    case 'template':
      return `${intent.title ? `File “${intent.title}”` : 'File'} from the ${intent.template} template${on}`;
    case 'newCycle':
      return `Plan a ${intent.days}-day cycle${on}, from today or after the cycles already planned`;
    case 'newRelease':
      return `Plan the release “${intent.name}”${
        intent.targetOn ? `, aimed at ${dateLine(new Date(`${intent.targetOn}T12:00`), false)}` : ''
      }`;
  }
}

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
    case 'plan':
    case 'unplan':
    case 'template':
    case 'newCycle':
    case 'newRelease':
      return describeMaking(intent);
    case 'newBoard':
      return `Create the board “${intent.name}”${
        intent.template
          ? `, with the ${TEMPLATE_DETAILS[intent.template].label} starter issues`
          : ''
      }`;
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
  'template',
  'plan',
  'unplan',
  'newCycle',
  'newRelease',
  'newBoard',
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
  /** A template's name, as said, to file a new issue from. */
  template: z.string().nullable().optional(),
  /** Where an issue is put, or taken out of: its cycle or its release. */
  into: z.enum(['cycle', 'release']).nullable().optional(),
  /** How many days a new cycle runs, when said. */
  days: z.number().nullable().optional(),
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
    case 'plan':
    case 'unplan':
      return movedFromParts(parts, issueKey);
    default:
      return null;
  }
}

/** An issue into a cycle or release, or out of one; null when where is not said. */
function movedFromParts(parts: SaphaParts, issueKey: string): SaphaIntent | null {
  if (!parts.into) return null;
  if (parts.kind === 'unplan') return { kind: 'unplan', issueKey, from: parts.into };
  return { kind: 'plan', issueKey, into: parts.into, name: words(parts.title, 80) };
}

/** A new cycle or release from the provider's parts; null when they do not hold. */
function planningFromParts(parts: SaphaParts, now: Date): SaphaIntent | null {
  if (parts.kind === 'newCycle') {
    const days = parts.days ?? CYCLE_DAYS_DEFAULT;
    const fits = Number.isInteger(days) && days >= 1 && days <= CYCLE_DAYS_MAX;
    return fits ? { kind: 'newCycle', days, board: words(parts.board, 80) } : null;
  }
  const name = words(parts.title, 80);
  if (!name) return null;
  if (!parts.when) return { kind: 'newRelease', name, targetOn: null };
  const when = parseWhen(parts.when, now);
  return when ? { kind: 'newRelease', name, targetOn: dayOf(when) } : null;
}

/** A new issue, plain or from a template, from the provider's parts; null when they do not hold. */
function newIssueFromParts(parts: SaphaParts): SaphaIntent | null {
  const title = words(parts.title, 200);
  const board = words(parts.board, 80);
  if (parts.kind === 'create') return title ? { kind: 'create', title, board } : null;
  const template = words(parts.template ?? null, 60);
  return template ? { kind: 'template', template, title, board } : null;
}

/** An intent from the provider's parts, checked as tier 0's are; null when they do not hold. */
export function intentFromParts(parts: SaphaParts, now: Date = new Date()): SaphaIntent | null {
  const issueKey = keyOf(parts);
  if (issueKey) {
    const change = issueIntent(parts, issueKey, now);
    if (change) return change;
  }
  if (parts.kind === 'create' || parts.kind === 'template') return newIssueFromParts(parts);
  if (parts.kind === 'newCycle' || parts.kind === 'newRelease') {
    return planningFromParts(parts, now);
  }
  return elsewhereFromParts(parts, now);
}

/** A new board by name, with a built-in template when one is said; null when they do not hold. */
function boardFromParts(parts: SaphaParts): SaphaIntent | null {
  const said = parts.title?.trim().replace(/^["“]|["”]$/g, '') ?? '';
  const name = said.length <= BOARD_NAME_MAX ? words(said, BOARD_NAME_MAX) : null;
  if (!name) return null;
  const asked = words(parts.template ?? null, 60);
  if (!asked) return { kind: 'newBoard', name, template: null };
  const template = builtInTemplate(asked.replace(/ template$/i, ''));
  return template ? { kind: 'newBoard', name, template } : null;
}

/** A board, a meeting, a search, a place, or a question about a cycle or release. */
function elsewhereFromParts(parts: SaphaParts, now: Date): SaphaIntent | null {
  switch (parts.kind) {
    case 'newBoard':
      return boardFromParts(parts);
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
