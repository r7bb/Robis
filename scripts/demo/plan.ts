/**
 * What the demo's life does next (demo:life): pure, so the choices are
 * tested without a stack. Who acts, what they do, and with which words,
 * each picked at random from what that role may do, never the same line
 * twice running.
 */

/** Everything the demo's people and agents do. */
export const ACTIONS = [
  'chat',
  'post',
  'react',
  'issueComment',
  'postComment',
  'move',
  'file',
] as const;
export type Action = (typeof ACTIONS)[number];

/** Who is acting: a seeded person by role, or one of the demo's agents. */
export type ActorRole = 'ADMIN' | 'MEMBER' | 'GUEST' | 'AGENT';

/** How often each happens, relative to the others: talk most, file least. */
export const WEIGHTS: Readonly<Record<Action, number>> = {
  chat: 30,
  post: 8,
  react: 16,
  issueComment: 14,
  postComment: 10,
  move: 16,
  file: 6,
};

/**
 * What each role may do, as the workspace's permissions allow it: a guest
 * talks, comments and reacts but files and moves nothing and posts no
 * post of its own; an agent works and posts but does not react.
 */
const MAY: Readonly<Record<ActorRole, ReadonlySet<Action>>> = {
  ADMIN: new Set(ACTIONS),
  MEMBER: new Set(ACTIONS),
  GUEST: new Set<Action>(['chat', 'react', 'issueComment', 'postComment']),
  AGENT: new Set<Action>(['chat', 'post', 'issueComment', 'move', 'file']),
};

/** Past this many open issues nobody files another: the board stays readable. */
export const MAX_OPEN_ISSUES = 30;

/** Lines not to repeat: the last few said anywhere. */
export const RECENT_LINES = 12;

export type Random = () => number;

export function mayDo(role: ActorRole, action: Action): boolean {
  return MAY[role].has(action);
}

/** One of `choices`, each as likely as its weight; null when all weigh nothing. */
export function pickWeighted<T>(
  choices: readonly { value: T; weight: number }[],
  random: Random,
): T | null {
  const total = choices.reduce((sum, choice) => sum + Math.max(0, choice.weight), 0);
  if (total <= 0) return null;
  let point = random() * total;
  for (const choice of choices) {
    point -= Math.max(0, choice.weight);
    if (point < 0) return choice.value;
  }
  return choices.at(-1)?.value ?? null;
}

/** What `role` does next, given how many issues are open. */
export function nextAction(role: ActorRole, openIssues: number, random: Random): Action | null {
  return pickWeighted(
    ACTIONS.filter((action) => mayDo(role, action)).map((action) => ({
      value: action,
      weight: action === 'file' && openIssues >= MAX_OPEN_ISSUES ? 0 : WEIGHTS[action],
    })),
    random,
  );
}

const FORWARD: Readonly<Record<string, string>> = {
  TODO: 'IN_PROGRESS',
  IN_PROGRESS: 'IN_REVIEW',
  IN_REVIEW: 'DONE',
};

/** One step along the board, or null when there is nowhere further to go. */
export function nextStatus(status: string): string | null {
  return FORWARD[status] ?? null;
}

/** A line from `bank` not said lately; any line when every one was. */
export function pickFresh(bank: readonly string[], recent: readonly string[], random: Random) {
  if (bank.length === 0) throw new RangeError('an empty bank');
  const fresh = bank.filter((line) => !recent.includes(line));
  const from = fresh.length > 0 ? fresh : bank;
  return from[Math.floor(random() * from.length)]!;
}

/** The recent lines with `line` added, keeping only the last RECENT_LINES. */
export function remember(recent: readonly string[], line: string): string[] {
  return [...recent, line].slice(-RECENT_LINES);
}

/** A pause between `minMs` and `maxMs`, so the activity has no clockwork beat. */
export function pause(minMs: number, maxMs: number, random: Random): number {
  return Math.round(minMs + random() * (maxMs - minMs));
}

/** One item of a list at random, or null for an empty one. */
export function pickOne<T>(items: readonly T[], random: Random): T | null {
  return items.length === 0 ? null : items[Math.floor(random() * items.length)]!;
}
