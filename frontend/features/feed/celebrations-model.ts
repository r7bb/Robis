import type { contracts, ResponseOf } from '@robis/shared';

/**
 * Celebrations as the Feed words them (Phase 2c): pure, so what a card
 * says, and the well done it starts, are tested without a browser. No
 * pronouns: the card says the name.
 */

export type Celebration = ResponseOf<
  (typeof contracts)['feed.celebrations']
>['celebrations'][number];

export const celebrationsKey = (workspaceId: string) => ['feed-celebrations', workspaceId] as const;

/** Celebrations shown at once: a few, not a wall of them. */
export const CELEBRATIONS_SHOWN = 5;

const years = (n: number) => (n === 1 ? 'a year' : `${n} years`);

/** A first name to address someone by; the whole name if there is no space. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The card's line, given the person's name (or "Someone" if unknown). */
export function lineOf(celebration: Celebration, name: string): string {
  switch (celebration.kind) {
    case 'issues_done':
      return `${name} has finished ${celebration.count} issues here`;
    case 'anniversary':
      return `${name} has been with the team for ${years(celebration.count ?? 1)}`;
    case 'joined':
      return `${name} joined the team this week`;
    case 'project_finished':
      return `${celebration.projectName ?? 'A project'} is done: every issue closed`;
  }
}

/** The words a well done starts with, in the composer, to change or send. */
export function wellDoneOf(celebration: Celebration, name: string): string {
  const first = firstName(name);
  switch (celebration.kind) {
    case 'issues_done':
      return `Well done, ${first}, on ${celebration.count} issues finished!`;
    case 'anniversary':
      return `Happy anniversary, ${first}: ${years(celebration.count ?? 1)} with the team!`;
    case 'joined':
      return `Welcome to the team, ${first}!`;
    case 'project_finished':
      return `${celebration.projectName ?? 'The project'} is done. Well done, everyone!`;
  }
}

/** What this person has put away, kept in their browser only. */
const PUT_AWAY_KEY = 'robis.celebrations.away';

export function readPutAway(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${PUT_AWAY_KEY}.${userId}`);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Saved pruned to what is still showing, so it never outgrows a week. */
export function writePutAway(
  userId: string,
  ids: ReadonlySet<string>,
  live: readonly Celebration[],
) {
  const kept = live.map((c) => c.id).filter((id) => ids.has(id));
  try {
    localStorage.setItem(`${PUT_AWAY_KEY}.${userId}`, JSON.stringify(kept));
  } catch {
    // Private mode or full storage: it comes back next visit, nothing worse.
  }
}
