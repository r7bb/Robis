import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';

/**
 * Card order on the board (C1): fractional keys, so moving one card between
 * two others gives that card a key between theirs and writes nothing else.
 * Keys sort as plain strings; ascending is top to bottom.
 */

/** A key as the API accepts it: the library's alphabet, and short. */
export const positionSchema = z
  .string()
  .regex(/^[A-Za-z][0-9A-Za-z]{1,79}$/, 'Not a board position');

/**
 * A key between `before` and `after` (null for either end). Neighbours that
 * cannot be ordered (two cards that ended up with the same key, created at
 * the same moment) give a key after `before`, which still places the card
 * below the one it was dropped under.
 */
export function positionBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    return generateKeyBetween(before, null);
  }
}

/** Ascending by key; a card with no key yet (made offline) comes first. */
export function byPosition<T extends { position: string | null; number: number }>(a: T, b: T) {
  if (a.position === null || b.position === null) {
    if (a.position === b.position) return b.number - a.number;
    return a.position === null ? -1 : 1;
  }
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  return b.number - a.number;
}
