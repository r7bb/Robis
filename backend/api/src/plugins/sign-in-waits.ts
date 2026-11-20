/**
 * Growing waits after failed sign-ins (C4).
 *
 * Counted for the address as typed, whether or not an account has it, so a
 * wait says nothing about who is registered. Two counts:
 *
 * - Per address and network address: the first few wrong passwords are
 *   free, then each one doubles the wait before the next try from there, up
 *   to a ceiling. Someone guessing from one place gets about a hundred tries
 *   a day; the account's owner, elsewhere, is not held up by it.
 * - Per address alone, looser: past a cap within the hour every try for it
 *   waits for the hour to turn, so guesses spread over many machines are
 *   bounded too. Reaching it takes many machines, which is the price of not
 *   letting one machine lock anyone out.
 *
 * A try is counted and judged in one step, on the count before it, so tries
 * sent all at once are counted one by one rather than all let through as
 * the first. A try refused during a wait is taken back and counts for
 * nothing, so an early retry does not lengthen the wait, and only tries let
 * through count towards the address's hourly cap. The right password
 * clears the address's counts, as a password reset does.
 *
 * Counted in the app's rate store (A6): in Postgres in production, so every
 * API instance sees the same counts; in memory for tests and development.
 * Keys carry the address and place only hashed, there.
 */

import { networkOf } from './client-network.ts';
import type { RateStore } from './rate-store.ts';

export { networkOf };

/** The wrong password, from one place, that starts the first wait. */
export const FREE_SIGN_IN_FAILURES = 5;
/** The first wait, doubled with each failure after it. */
export const FIRST_SIGN_IN_WAIT_MS = 30_000;
/** The longest wait, however many failures: a quarter of an hour. */
export const MAX_SIGN_IN_WAIT_MS = 15 * 60_000;
/** Wrong passwords for one address from anywhere in an hour before all wait. */
export const ADDRESS_FAILURES_PER_HOUR = 100;
/** Counts older than this are forgotten. */
const MEMORY_MS = 60 * 60_000;

/** The address as keys hold it: `|` separates a key's parts, so it is escaped. */
const normal = (address: string) => address.trim().toLowerCase().replaceAll('|', '%7C');
/** A place's count runs on while tries keep coming; the address's is a fixed hour. */
const SLIDING = { sliding: true } as const;
const placeKey = (address: string, place: string) =>
  `signin-place:${normal(address)}|${networkOf(place)}`;
const addressKey = (address: string) => `signin-address:${normal(address)}`;

/** How long a wait this many failures from one place earns: none while still free. */
export function waitAfter(count: number): number {
  if (count < FREE_SIGN_IN_FAILURES) return 0;
  const doublings = count - FREE_SIGN_IN_FAILURES;
  return Math.min(FIRST_SIGN_IN_WAIT_MS * 2 ** doublings, MAX_SIGN_IN_WAIT_MS);
}

/**
 * One more try for this address from this place, counted before its
 * password is checked: 0 when it may go ahead, otherwise how many
 * milliseconds until the next may, judged on the store's clock.
 */
export async function admitSignInAttempt(
  store: RateStore,
  address: string,
  place: string,
): Promise<number> {
  const hereKey = placeKey(address, place);
  const here = await store.hit(hereKey, MEMORY_MS, SLIDING);
  const before = here.previous;
  // No wait owed is no wait at all, whatever the clocks say.
  const owed = before ? waitAfter(before.count) : 0;
  const fromHere = before && owed > 0 ? Math.max(0, before.lastAt + owed - here.now) : 0;
  if (fromHere > 0) {
    await store.takeBack(hereKey, here, MEMORY_MS, SLIDING);
    return fromHere;
  }
  const key = addressKey(address);
  const everywhere = await store.hit(key, MEMORY_MS);
  if ((everywhere.previous?.count ?? 0) < ADDRESS_FAILURES_PER_HOUR) return 0;
  await Promise.all([
    store.takeBack(key, everywhere, MEMORY_MS),
    store.takeBack(hereKey, here, MEMORY_MS, SLIDING),
  ]);
  return Math.max(0, everywhere.resetAt - everywhere.now);
}

/**
 * The right password, or a reset: the address starts again, from everywhere
 * (a reset proves the address, and a right password the person).
 */
export async function clearSignInFailures(store: RateStore, address: string): Promise<void> {
  await Promise.all([
    store.clearPrefix(addressKey(address)),
    store.clearPrefix(`signin-place:${normal(address)}|`),
  ]);
}
