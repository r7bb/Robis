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
 * A try is counted before its password is checked, so tries sent all at once
 * cannot all slip in before the first is counted; the right password takes
 * its try back and clears the address's counts, as a password reset does.
 *
 * Kept in memory, as the request limits are: with several API instances each
 * keeps its own counts, which loosens the bounds by that factor but never
 * keeps anyone waiting longer. The map is capped, oldest first: a flood of
 * new addresses could push an old count out early, but a count under attack
 * is refreshed by every try and so is never the oldest.
 */

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
/** Counts kept at most; past this the oldest go first. */
const MAX_ENTRIES = 100_000;
const SWEEP_INTERVAL_MS = 60_000;

type Count = { count: number; firstAt: number; lastAt: number };

const counts = new Map<string, Count>();
/** Each address's place keys, so clearing an address need not scan the map. */
const placesOf = new Map<string, Set<string>>();
let lastSweep = Date.now();

const normal = (address: string) => address.trim().toLowerCase();
const addressKey = (address: string) => `a:${normal(address)}`;
const placeKey = (address: string, place: string) => `p:${normal(address)}|${networkOf(place)}`;

/**
 * Where a try comes from, as far as a wait goes: an IPv4 address, or the /64
 * an IPv6 one is in, since one household or server is usually given a whole
 * /64 and could otherwise move to a fresh address for every guess.
 */
export function networkOf(ip: string): string {
  const bare = ip.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!bare.includes(':')) return bare;
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(bare)) return bare.slice(7);
  const [head = '', tail = ''] = bare.toLowerCase().split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const missing = bare.includes('::') ? 8 - front.length - back.length : 0;
  const groups = [...front, ...Array(Math.max(0, missing)).fill('0'), ...back];
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of counts) {
    if (now - entry.lastAt > MEMORY_MS) counts.delete(key);
  }
  for (const [address, keys] of placesOf) {
    for (const key of keys) if (!counts.has(key)) keys.delete(key);
    if (keys.size === 0) placesOf.delete(address);
  }
}

function live(key: string, now: number): Count | undefined {
  const entry = counts.get(key);
  return entry && now - entry.lastAt <= MEMORY_MS ? entry : undefined;
}

/**
 * One more on a count. A place's count runs on while tries keep coming; an
 * address's is a fixed hour, started afresh once its hour is over, so its
 * cap never goes stale.
 */
function bump(key: string, now: number, fixedWindow: boolean) {
  const current = live(key, now);
  const entry = fixedWindow && current && now - current.firstAt > MEMORY_MS ? undefined : current;
  // Deleted first, so the map's order stays oldest first for the cap.
  counts.delete(key);
  counts.set(key, {
    count: (entry?.count ?? 0) + 1,
    firstAt: entry?.firstAt ?? now,
    lastAt: now,
  });
  if (counts.size > MAX_ENTRIES) {
    const oldest = counts.keys().next().value;
    if (oldest !== undefined) counts.delete(oldest);
  }
}

/** How long a wait this many failures from one place earns: none while still free. */
export function waitAfter(count: number): number {
  if (count < FREE_SIGN_IN_FAILURES) return 0;
  const doublings = count - FREE_SIGN_IN_FAILURES;
  return Math.min(FIRST_SIGN_IN_WAIT_MS * 2 ** doublings, MAX_SIGN_IN_WAIT_MS);
}

/** Milliseconds before this address may be tried again from this place; 0 when now. */
export function signInWaitFor(address: string, place: string, now = Date.now()): number {
  sweep(now);
  const here = live(placeKey(address, place), now);
  const fromHere = here ? Math.max(0, here.lastAt + waitAfter(here.count) - now) : 0;
  const everywhere = live(addressKey(address), now);
  const fromAnywhere =
    everywhere &&
    now - everywhere.firstAt <= MEMORY_MS &&
    everywhere.count >= ADDRESS_FAILURES_PER_HOUR
      ? Math.max(0, everywhere.firstAt + MEMORY_MS - now)
      : 0;
  return Math.max(fromHere, fromAnywhere);
}

/** One more try for this address from this place, counted before its password is checked. */
export function recordSignInAttempt(address: string, place: string, now = Date.now()): void {
  sweep(now);
  const key = placeKey(address, place);
  bump(key, now, false);
  bump(addressKey(address), now, true);
  const keys = placesOf.get(normal(address)) ?? new Set<string>();
  placesOf.set(normal(address), keys.add(key));
}

/**
 * The right password, or a reset: the address starts again, from everywhere
 * (a reset proves the address, and a right password the person).
 */
export function clearSignInFailures(address: string): void {
  counts.delete(addressKey(address));
  for (const key of placesOf.get(normal(address)) ?? []) counts.delete(key);
  placesOf.delete(normal(address));
}

/** For tests, with the request limits. */
export function resetSignInWaits(): void {
  counts.clear();
  placesOf.clear();
  lastSweep = Date.now();
}
