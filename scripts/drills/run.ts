/**
 * Failure drills against a running compose stack (E2): `bun run drills`.
 *
 * Each drill breaks one part of the stack on purpose and checks Robis
 * recovers with no lost write and nothing done twice:
 *
 *   worker    killed (SIGKILL) while it is sending a burst of sign-up mail;
 *             once restarted, every address has exactly one email.
 *   gateway   killed with a board open in Chrome; an issue filed while it
 *             is down appears on the board once it is back, unreloaded.
 *   postgres  restarted while keyed writes are being made; every write the
 *             API acknowledged is there once, and the API answers again.
 *   ml        stopped; the composer's hints answer at once with nothing,
 *             and come back when it is started again.
 *
 * Uses `docker compose`, so it runs where the stack runs (here and in CI).
 * `DRILL=worker` runs just one.
 */

import { Checks } from '../journeys/checks.ts';
import { api, leave, type Person, person, project } from '../journeys/people.ts';
import { focus, press, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';

const COMPOSE = ['docker', 'compose', '-f', process.env.COMPOSE_FILE ?? 'deploy/compose.yaml'];
const MAIL = process.env.SMOKE_MAIL_URL ?? 'http://127.0.0.1:8025';
const API = `${process.env.SMOKE_WEB_URL ?? 'http://127.0.0.1:3000'}/api`;
const ORIGIN = 'http://localhost:3000';
const RECOVER_MS = 90_000;
const FIRST_PORT = Number(process.env.DRILL_CDP_PORT ?? 9520);
const WRITES_MAX = 90;
const WRITE_GAP_MS = 100;

function compose(...args: string[]) {
  const run = Bun.spawnSync([...COMPOSE, ...args], { stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`compose ${args.join(' ')}: ${run.stderr.toString()}`);
}

/** Poll `probe` until it is true or `ms` pass. */
async function until(probe: () => Promise<boolean>, ms = RECOVER_MS): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await probe().catch(() => false)) return true;
    await Bun.sleep(500);
  }
  return false;
}

const healthy = () => fetch(`${API}/health`).then((r) => r.ok);

async function workerDrill(checks: Checks) {
  process.stdout.write('Worker killed mid-burst\n');
  const run = Date.now().toString(36);
  const emails = Array.from({ length: 6 }, (_, i) => `drill-${run}-${i}@robis.test`);
  // Each sign-up queues one mail job for the worker.
  await Promise.all(
    emails.map((email) =>
      fetch(`${API}/auth/signup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email }),
      }),
    ),
  );
  compose('kill', '-s', 'SIGKILL', 'worker');
  await Bun.sleep(1_000);
  compose('start', 'worker');
  const counts = async () => {
    const { messages } = (await (await fetch(`${MAIL}/messages`)).json()) as {
      messages: { to: string[] }[];
    };
    return emails.map((email) => messages.filter((m) => m.to.includes(email)).length);
  };
  // A job claimed before the kill is taken back after its visibility timeout (60 s).
  const delivered = await until(async () => (await counts()).every((n) => n >= 1), RECOVER_MS * 2);
  checks.check(
    'every address got its email after the restart',
    delivered,
    JSON.stringify(await counts()),
  );
  await Bun.sleep(2_000);
  checks.check(
    'and none got it twice',
    (await counts()).every((n) => n === 1),
    JSON.stringify(await counts()),
  );
}

async function gatewayDrill(checks: Checks) {
  process.stdout.write('Gateway killed with a board open\n');
  let owner: Person | undefined;
  try {
    owner = await person(FIRST_PORT, 'drillgw');
    const projectId = await project(owner, 'Drill');
    await owner.page.goto(`${WEB}/workspaces/${owner.workspaceId}/projects/${projectId}`);
    await owner.page.waitFor(
      `!!document.querySelector('input[aria-label="New issue title"]')`,
      WAIT_MS,
    );
    compose('kill', 'realtime');
    const title = `Filed while the gateway was down ${Date.now().toString(36)}`;
    await api(owner.page, `/workspaces/${owner.workspaceId}/projects/${projectId}/issues`, 'POST', {
      title,
    });
    compose('start', 'realtime');
    const shows = `[...document.querySelectorAll('[data-card]')].some((c) => c.getAttribute('aria-label')?.includes(${JSON.stringify(title)}))`;
    checks.check(
      'the open board shows it once the gateway is back, unreloaded',
      await waitUntil(owner.page, shows, RECOVER_MS),
    );
    // And live updates work again: one more, typed on the board.
    await focus(owner.page, 'input[aria-label="New issue title"]');
    await typeText(owner.page, 'After the gateway came back');
    await press(owner.page, 'Enter');
    checks.check(
      'the board syncs again',
      await waitUntil(owner.page, `!document.body.textContent.includes('Unsynced')`),
    );
  } finally {
    leave([owner]);
  }
}

async function postgresDrill(checks: Checks) {
  process.stdout.write('Postgres restarted under writes\n');
  let owner: Person | undefined;
  try {
    owner = await person(FIRST_PORT + 1, 'drillpg');
    const projectId = await project(owner, 'Drill');
    const path = `/workspaces/${owner.workspaceId}/projects/${projectId}/issues`;
    const acknowledged: string[] = [];
    let writing = true;
    const writer = (async () => {
      // At most 90, spaced out to span the restart, so one page lists them all.
      for (let i = 0; writing && i < WRITES_MAX; i++) {
        await Bun.sleep(WRITE_GAP_MS);
        const title = `Write ${i}`;
        // A retried write carries the same key, as the offline queue's do.
        const key = crypto.randomUUID();
        for (let attempt = 0; attempt < 30; attempt++) {
          const result = await owner!.page.eval<number>(`fetch('/api${path}', {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json', 'idempotency-key': ${JSON.stringify(key)} },
            body: JSON.stringify({ title: ${JSON.stringify(title)} }),
          }).then((r) => r.status, () => 0)`);
          if (result === 201) {
            acknowledged.push(title);
            break;
          }
          await Bun.sleep(1_000);
        }
      }
    })();
    await Bun.sleep(1_500);
    compose('restart', 'postgres');
    checks.check('the API answers again after the restart', await until(healthy));
    await Bun.sleep(3_000);
    writing = false;
    await writer;
    const { issues } = await api<{ issues: { title: string }[] }>(owner.page, `${path}?limit=100`);
    const titles = issues.map((issue) => issue.title);
    const missing = acknowledged.filter((t) => !titles.includes(t));
    const doubled = titles.filter((t, i) => titles.indexOf(t) !== i);
    checks.check(
      `every acknowledged write is there (${acknowledged.length})`,
      missing.length === 0,
      missing.join(', '),
    );
    checks.check('and none is there twice', doubled.length === 0, doubled.join(', '));
  } finally {
    leave([owner]);
  }
}

async function mlDrill(checks: Checks) {
  process.stdout.write('ML service stopped\n');
  let owner: Person | undefined;
  try {
    owner = await person(FIRST_PORT + 2, 'drillml');
    const ask = `/workspaces/${owner.workspaceId}/issues/suggestions?title=${encodeURIComponent('Login is broken')}`;
    compose('stop', 'ml');
    const started = Date.now();
    const answer = await api<{ similar: unknown[] }>(owner.page, ask);
    checks.check(
      'hints answer within two seconds, with nothing',
      Date.now() - started < 2_000 && Array.isArray(answer.similar),
    );
    compose('start', 'ml');
    checks.check(
      'and answer again once it is back',
      await until(async () =>
        Array.isArray((await api<{ similar: unknown[] }>(owner!.page, ask)).similar),
      ),
    );
  } finally {
    leave([owner]);
  }
}

const DRILLS: Record<string, (checks: Checks) => Promise<void>> = {
  worker: workerDrill,
  gateway: gatewayDrill,
  postgres: postgresDrill,
  ml: mlDrill,
};

const only = process.env.DRILL;
const checks = new Checks();
process.stdout.write(`Failure drills against ${API}\n`);
for (const [name, drill] of Object.entries(DRILLS)) {
  if (only && only !== name) continue;
  try {
    await drill(checks);
  } catch (error) {
    checks.check(
      `${name} ran to the end`,
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
  // Every drill leaves the stack whole for the next.
  compose('up', '-d', '--wait');
}
if (checks.failures > 0) {
  process.stderr.write(`Failure drills failed: ${checks.failures} check(s).\n`);
  process.exit(1);
}
process.stdout.write('Failure drills passed.\n');
