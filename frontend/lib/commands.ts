import type { Role } from '@robis/shared';
import { type Action, may } from './permissions.ts';

/**
 * The command palette's list (C2): what a command is, who may see it, and
 * how what was typed picks and orders them. No React here, so it is tested
 * on its own.
 */

const COMMAND_GROUPS = [
  'Actions',
  'Boards',
  'Issues',
  'Documents',
  'Channels',
  'People',
  'Search',
] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

export type Command = {
  id: string;
  title: string;
  group: CommandGroup;
  /** What the command does, if it changes anything; hidden from a role that may not. */
  action?: Action;
  /** Other words it answers to, weighed below the title. */
  keywords?: readonly string[];
  /** Quiet text on the right: a shortcut, or where it leads. */
  hint?: string;
  run?: () => void;
  /** A second list to choose from, in place of running. */
  children?: readonly Command[];
  /** Let a search find the children on their own ("done" finds "Change status to Done"). */
  flatten?: boolean;
};

/** Lowercase without accents, so "zoe" finds "Zoë". */
function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

const START_OF_TITLE = 3;
const START_OF_WORD = 2;
const INSIDE_WORD = 1;
/** Taken off a match found only in the keywords. */
const KEYWORD_PENALTY = 0.5;

function wordScore(haystack: string, word: string): number {
  if (haystack.startsWith(word)) return START_OF_TITLE;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`[\\s\\-_/·.]${escaped}`).test(haystack)) return START_OF_WORD;
  return haystack.includes(word) ? INSIDE_WORD : 0;
}

/** The sum over the words typed, or 0 when any one is missing. */
function scoreIn(haystack: string, words: readonly string[]): number {
  let score = 0;
  for (const word of words) {
    const one = wordScore(haystack, word);
    if (one === 0) return 0;
    score += one;
  }
  return score;
}

/**
 * How well a title (or its keywords) matches what was typed: 0 for no match.
 * Every word typed must appear; one at the start of the title counts most,
 * then one at the start of any word, then one inside a word.
 */
export function matchScore(title: string, query: string, keywords: readonly string[] = []): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const inTitle = scoreIn(fold(title), words);
  if (inTitle > 0) return inTitle;
  if (keywords.length === 0) return 0;
  const inAll = scoreIn(fold([title, ...keywords].join(' ')), words);
  return inAll > 0 ? Math.max(inAll - KEYWORD_PENALTY, INSIDE_WORD / 2) : 0;
}

/**
 * The commands matching `query`, best first (ties keep their order). With
 * nothing typed, the list as given. A parent that matches stands for its
 * children; one marked `flatten` also lets a child be found on its own.
 */
export function rankCommands(commands: readonly Command[], query: string): Command[] {
  if (!query.trim()) return [...commands];
  const scored: { command: Command; score: number; order: number }[] = [];
  for (const command of commands) {
    const score = matchScore(command.title, query, command.keywords);
    if (score > 0) {
      scored.push({ command, score, order: scored.length });
      continue;
    }
    if (!command.flatten) continue;
    for (const child of command.children ?? []) {
      const childScore = matchScore(child.title, query, child.keywords);
      if (childScore > 0) scored.push({ command: child, score: childScore, order: scored.length });
    }
  }
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((s) => s.command);
}

/** At most this many of one group, so one long list cannot push out the rest. */
export const GROUP_CAP = 6;
/** What shows before anything is typed: things to do and places to go. */
const BROWSING_GROUPS: readonly CommandGroup[] = ['Actions', 'Boards'];

/**
 * The list as shown: in fixed group order, each group capped, keeping the
 * order within a group. While `browsing` (nothing typed, top of the
 * palette) only actions and boards show; people and channels wait for a
 * name.
 */
export function arrangeCommands(
  commands: readonly Command[],
  { browsing }: { browsing: boolean },
): { group: CommandGroup; commands: Command[] }[] {
  return COMMAND_GROUPS.filter((group) => !browsing || BROWSING_GROUPS.includes(group))
    .map((group) => ({
      group,
      commands: commands.filter((c) => c.group === group).slice(0, GROUP_CAP),
    }))
    .filter((section) => section.commands.length > 0);
}

/**
 * What this role may see: a command whose action it may not take is gone,
 * the same check its button makes (see `may`). Children are checked too,
 * and a parent left with nothing to choose is dropped.
 */
export function allowedCommands(commands: readonly Command[], role: Role | undefined): Command[] {
  const allowed: Command[] = [];
  for (const command of commands) {
    if (command.action && !may(role, command.action)) continue;
    if (!command.children) {
      allowed.push(command);
      continue;
    }
    const children = allowedCommands(command.children, role);
    if (children.length > 0) allowed.push({ ...command, children });
  }
  return allowed;
}

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/** Ctrl K, or Cmd K on a Mac; nothing with Alt or Shift held as well. */
export function isPaletteShortcut(event: KeyLike): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'k'
  );
}
