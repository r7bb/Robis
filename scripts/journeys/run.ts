/**
 * Browser journeys against a running stack (E1): `bun run journeys`.
 *
 * Whole journeys, each in real headless Chrome against the compose stack,
 * as people would take them: sign-up with email verification through the
 * mail sink, an offline board write and reconnect, two people editing one
 * document, chat delivery, a meeting reschedule clearing answers, a guest
 * seeing no write controls, someone outside the workspace getting not
 * found, the empty views (C5) moving to the field that fills them, the
 * demo workspace opening from the first run, and a workspace export
 * downloaded once and a CSV imported once (C6).
 * Each journey's people get Chromes of their own and fresh accounts, never
 * the demo ones. Run in CI on every push and pull request.
 *
 * Only Bun and the repository's CDP helper. `JOURNEY=offline` (a name from
 * the list below) runs just one, for working on it.
 */

import { WEB } from '../smoke/browser-session.ts';
import { Checks } from './checks.ts';
import { demoWorkspaceJourney, emptyViewsJourney } from './empty-views.ts';
import { exportJourney } from './export.ts';
import { importJourney } from './import.ts';
import { guestJourney, meetingJourney, strangerJourney } from './meetings-access.ts';
import { offlineBoardJourney } from './offline-board.ts';
import { signupJourney } from './signup.ts';
import { chatJourney, documentJourney } from './together.ts';

/** Debugging ports, one per Chrome, clear of the smoke tests' 9487 and 9488. */
const FIRST_PORT = Number(process.env.JOURNEY_CDP_PORT ?? 9500);
const pair = (n: number) => [FIRST_PORT + n * 2, FIRST_PORT + n * 2 + 1] as const;

const JOURNEYS: Record<string, (checks: Checks) => Promise<void>> = {
  signup: (checks) => signupJourney(checks, FIRST_PORT),
  offline: (checks) => offlineBoardJourney(checks, FIRST_PORT + 1),
  document: (checks) => documentJourney(checks, pair(1)),
  chat: (checks) => chatJourney(checks, pair(2)),
  meeting: (checks) => meetingJourney(checks, pair(3)),
  guest: (checks) => guestJourney(checks, pair(4)),
  stranger: (checks) => strangerJourney(checks, pair(5)),
  empty: (checks) => emptyViewsJourney(checks, FIRST_PORT + 12),
  demo: (checks) => demoWorkspaceJourney(checks, FIRST_PORT + 13),
  export: (checks) => exportJourney(checks, FIRST_PORT + 14),
  import: (checks) => importJourney(checks, FIRST_PORT + 15),
};

async function main() {
  process.stdout.write(`Browser journeys against ${WEB}\n`);
  const only = process.env.JOURNEY;
  if (only && !JOURNEYS[only]) throw new Error(`no journey named ${only}`);
  const checks = new Checks();
  for (const [name, journey] of Object.entries(JOURNEYS)) {
    if (only && name !== only) continue;
    try {
      await journey(checks);
    } catch (error) {
      checks.check(
        `${name} ran to the end`,
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  if (checks.failures > 0) {
    process.stderr.write(`Browser journeys failed: ${checks.failures} check(s).\n`);
    process.exit(1);
  }
  process.stdout.write('Browser journeys passed.\n');
}

await main();
