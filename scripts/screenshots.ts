/**
 * Capture every screenshot in the README.
 *
 *   bun run screenshots
 *
 * The README claims its screenshots come from the running app rather than a
 * mockup. This is the script that makes that claim checkable: it drives a real
 * Chrome over the DevTools Protocol against the real stack, and every image in
 * `docs/screenshots/` is its output.
 *
 * Chrome over CDP rather than Playwright, because Playwright's browser download
 * does not work on this machine and CDP is available without installing
 * anything -- Chrome is already here. The subset used is small: navigate,
 * evaluate, emulate offline, capture.
 *
 * Requires the stack to be running:
 *
 *   bun run db:start && bun run db:migrate
 *   NEXT_PUBLIC_ENABLE_SW=1 bun run dev:web
 *   AUTH_FORGOT_PER_HOUR=100 bun run dev:api
 *   bun run dev:realtime
 *
 * The two environment overrides exist because this script drives flows that
 * are deliberately restricted in normal operation: the service worker is off
 * under `next dev`, and reset requests are capped per address, which a script
 * re-running against one seeded account would otherwise exhaust.
 *
 * It re-seeds first, so the images are of the same content every time rather
 * than whatever happened to be in the database.
 */
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueAuthToken } from '@relay/auth';
import { createDatabase, users } from '@relay/database';
import { handlers } from '@relay/worker/handlers';
import { scanNudges } from '@relay/worker/nudges';
import { Runner } from '@relay/worker/runner';
import { eq } from 'drizzle-orm';
import {
  closeTab,
  findChrome,
  listTargets,
  openTab,
  Page,
  type PageConfig,
  type Target,
} from './lib/cdp.ts';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:4000';
const REALTIME = 'http://localhost:4001';
const CDP_PORT = 9333;
const SHOTS = new URL('../docs/screenshots/', import.meta.url).pathname;
const PROFILE = join(tmpdir(), 'relay-screenshots-chrome');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://relay:relay@localhost:5433/relay';

const EMAIL = 'rohit@relay.dev';
const PASSWORD = process.env.SEED_PASSWORD ?? 'relay-demo-password';

/** Retina, so the images stay sharp when GitHub scales them down. */
const SCALE = 2;
const WIDTH = 1440;
const HEIGHT = 900;

const cdp: PageConfig = {
  port: CDP_PORT,
  shotsDir: SHOTS,
  width: WIDTH,
  height: HEIGHT,
  scale: SCALE,
};

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

async function reachable(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function preflight() {
  const services: [string, string, string][] = [
    ['web', `${WEB}/login`, 'bun run dev:web'],
    ['api', `${API}/health`, 'bun run dev:api'],
    ['realtime', `${REALTIME}/health`, 'bun run dev:realtime'],
  ];

  const down = [];
  for (const [name, url, command] of services) {
    if (!(await reachable(url))) down.push(`  ${name} (${url}) — start it with: ${command}`);
  }

  if (down.length > 0) {
    console.error(`Cannot reach the stack:\n${down.join('\n')}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.waitFor('document.querySelector(\'input[type="email"]\')');
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.shot('01-login.png');

  await page.click('button[type="submit"]');
  await page.waitFor('location.pathname.startsWith("/workspaces")');
  await page.waitForText('Workspaces');
}

async function openWorkspace(page: Page): Promise<string> {
  await page.goto(`${WEB}/workspaces`);
  await page.waitForText('Engineering');
  await page.click('a[href^="/workspaces/"]');
  await page.waitForText('documents');
  return page.eval<string>('location.href');
}

/** The board for a named project. */
async function openBoard(page: Page, workspaceUrl: string, project: string): Promise<string> {
  await page.goto(workspaceUrl);
  await page.waitForText(project);
  await page.clickText('a[href*="/projects/"]', project);
  await page.waitFor('document.querySelector(\'input[placeholder="What needs doing?"]\')');
  return page.eval<string>('location.href');
}

async function captureBasics(page: Page) {
  console.log('\nBasics');
  await signIn(page);
  await page.shot('02-workspaces.png');

  const workspaceUrl = await openWorkspace(page);
  await page.shot('03-workspace.png');

  const boardUrl = await openBoard(page, workspaceUrl, 'Web App');
  await page.shot('04-board.png');

  return { workspaceUrl, boardUrl };
}

/** Two tabs on one board: an issue created in the second appears in the first. */
async function captureRealtime(page: Page, boardUrl: string) {
  console.log('\nRealtime');
  const other = await openTab(cdp, boardUrl);

  try {
    await other.waitFor('document.querySelector(\'input[placeholder="What needs doing?"]\')');
    await page.goto(boardUrl);
    await page.waitForText('online');

    await other.fill('input[placeholder="What needs doing?"]', 'Ship the activity feed');
    await other.click('form button[type="submit"]');

    // It arrives over the socket, not a poll, so this is fast.
    await page.waitForText('Ship the activity feed', 10_000);
    await page.shot('05-realtime.png');
  } finally {
    await closeTab(cdp, other);
  }
}

async function captureOffline(page: Page, boardUrl: string) {
  console.log('\nOffline');
  await page.goto(boardUrl);
  await page.waitFor('document.querySelector(\'input[placeholder="What needs doing?"]\')');

  /*
   * Is a service worker actually driving this page?
   *
   * Registration is not the same as control: a worker installed during one
   * navigation takes over on the next, so the page is reloaded once to hand it
   * control. The worker is also off by default under `next dev` -- a
   * cache-first worker in front of dev chunks produces stale-module errors --
   * so this may legitimately never be true, and the cold-reload shot is
   * skipped rather than failing the whole run.
   */
  let controlled = false;

  if (await page.eval<boolean>('"serviceWorker" in navigator')) {
    await page.goto(boardUrl);
    try {
      await page.waitFor('navigator.serviceWorker.controller !== null', 8000);
      controlled = true;
    } catch {
      console.warn(
        '  skipping 09-offline-cold-reload.png — no service worker in control.\n' +
          '  Start the web server with NEXT_PUBLIC_ENABLE_SW=1 to capture it.',
      );
    }
  }

  await page.setOffline(true);
  // The client polls reachability as well as reading navigator.onLine.
  await page.waitForText('offline', 15_000);

  for (const title of ['Write the migration guide', 'Audit the cache headers']) {
    await page.fill('input[placeholder="What needs doing?"]', title);
    await page.click('form button[type="submit"]');
    await Bun.sleep(400);
  }

  await page.waitForText('unsynced');
  await page.shot('06-offline-unsynced.png');

  // A cold reload with no network: the service worker serves the shell and the
  // board renders from IndexedDB.
  if (controlled) {
    await page.send('Page.reload', { ignoreCache: false });
    await page.waitFor('document.readyState === "complete"');
    await page.waitForText('Write the migration guide', 20_000);
    await page.shot('09-offline-cold-reload.png');
  }

  await page.setOffline(false);
  await page.waitForText('synced', 25_000);
  await Bun.sleep(1200);
  await page.shot('07-after-reconnect.png');
}

async function captureIssue(page: Page, boardUrl: string) {
  console.log('\nIssue detail');
  await page.goto(boardUrl);
  await page.waitFor('document.querySelector(\'a[href*="/issues/"]\')');
  await page.clickText('a[href*="/issues/"]', 'Safari');
  await page.waitForText('description');

  const issueUrl = await page.eval<string>('location.href');
  await page.shot('10-issue-detail.png');

  // Open the description editor and type into it.
  await page.clickText('button', 'Add a description');
  await page.waitFor('document.querySelector(\'textarea[aria-label="Issue description"]\')');
  await page.fill(
    'textarea[aria-label="Issue description"]',
    'Safari sends the refresh token as a query parameter on redirect, so it never reaches the handler.\n\nRepro: sign in on Safari 17, wait for the token to expire, then watch the network tab on the next request.',
  );
  await page.shot('21-issue-description-editing.png');

  await page.clickText('button', 'Save');
  await Bun.sleep(900);
  await page.goto(issueUrl);
  await page.waitForText('never reaches the handler');
  await page.shot('22-issue-description.png');

  return issueUrl;
}

/** A comment that mentions someone, so the worker has a notification to make. */
async function captureMention(page: Page, issueUrl: string) {
  console.log('\nMention');
  await page.goto(issueUrl);
  await page.waitFor('document.querySelector(\'textarea[aria-label="New comment"]\')');

  await page.fill(
    'textarea[aria-label="New comment"]',
    '@rohit this reproduces on 17.4 too — worth pulling into this week.',
  );
  await page.clickText('button', 'Comment');
  await Bun.sleep(900);
}

async function captureDocuments(page: Page, workspaceUrl: string) {
  console.log('\nDocuments');
  await page.goto(workspaceUrl);
  await page.waitForText('documents');

  await page.fill('input[placeholder="New document title"]', 'Sync protocol notes');
  await page.clickText('button', 'Create document');
  await Bun.sleep(1200);

  await page.waitFor('document.querySelector(\'a[href*="/documents/"]\')');
  await page.click('a[href*="/documents/"]');
  await page.waitFor('document.querySelector(\'textarea[aria-label="Document content"]\')');

  const documentUrl = await page.eval<string>('location.href');
  const other = await openTab(cdp, documentUrl);

  try {
    await other.waitFor('document.querySelector(\'textarea[aria-label="Document content"]\')');

    // Both windows edit. The CRDT merges rather than picking a winner.
    await page.fill(
      'textarea[aria-label="Document content"]',
      'Offline writes are queued in IndexedDB and flushed in order.\n',
    );
    await Bun.sleep(800);

    const merged =
      'Offline writes are queued in IndexedDB and flushed in order.\nExactly-once comes from client-generated ids plus a server ledger.\n';
    await other.fill('textarea[aria-label="Document content"]', merged);
    await Bun.sleep(1200);

    // A textarea's value is not part of `innerText`, so read the field.
    await page.waitFor(
      `document.querySelector('textarea[aria-label="Document content"]').value.includes('Exactly-once')`,
      15_000,
    );
    await page.shot('08-document-collab.png');
  } finally {
    await closeTab(cdp, other);
  }
}

async function captureThemes(page: Page, workspaceUrl: string, boardUrl: string) {
  console.log('\nThemes');
  await page.goto(workspaceUrl);
  await page.waitForText('theme');
  await page.shot('12-theme-midnight.png');

  await page.clickText('button', 'Daylight');
  await Bun.sleep(900);
  await page.shot('13-theme-daylight.png');

  await page.clickText('button', 'Forest');
  await Bun.sleep(900);
  await page.goto(boardUrl);
  await page.waitFor('document.querySelector(\'input[placeholder="What needs doing?"]\')');
  await page.shot('14-theme-forest-board.png');

  // Back to the default, so every later screenshot is consistent.
  await page.goto(workspaceUrl);
  await page.waitForText('theme');
  await page.clickText('button', 'Midnight');
  await Bun.sleep(900);
}

async function captureGuides(page: Page, workspaceId: string) {
  console.log('\nGuides');
  await page.goto(`${WEB}/guide/try_document?w=${workspaceId}`);
  await page.waitForText('document');
  await page.shot('15-guide-page.png');

  // The guide's action creates the sample document and opens it.
  await page.clickText('button', 'Create');
  await Bun.sleep(1800);
  await page.waitFor('location.pathname.includes("/documents/")', 15_000);
  await Bun.sleep(700);
  await page.shot('16-sample-document.png');
}

/**
 * The inbox, from the workspaces index.
 *
 * Deliberately not a `@mention` notification: mentioning yourself is not a
 * notification, and the demo seed is a single account, so there is nobody to
 * mention. Mentions are covered by `mentions.test.ts` and `queue.test.ts`;
 * seeding with `--team` is what makes them visible in the UI.
 */
async function captureInbox(page: Page) {
  console.log('\nInbox');
  await page.goto(`${WEB}/workspaces`);
  await page.waitForText('inbox');
  await page.clickText('button', 'Inbox');
  await Bun.sleep(900);
  await page.shot('11-notification-inbox.png');
}

async function captureNudge(page: Page, workspaceUrl: string) {
  console.log('\nNudge');
  await page.goto(workspaceUrl);
  await page.waitForText('inbox');
  await page.clickText('button', 'Inbox');
  await Bun.sleep(900);
  await page.shot('17-nudge-inbox.png');
}

async function captureSearch(page: Page, workspaceUrl: string) {
  console.log('\nSearch');
  await page.goto(workspaceUrl);
  await page.waitFor('document.querySelector(\'input[aria-label="Search this workspace"]\')');

  await page.fill('input[aria-label="Search this workspace"]', 'refresh token');
  await Bun.sleep(1400);
  await page.shot('18-search.png');
}

async function captureMembersAndActivity(page: Page, workspaceUrl: string) {
  console.log('\nMembers and activity');
  await page.goto(workspaceUrl);
  await page.waitForText('members');

  await page.eval(`(() => {
    const heading = [...document.querySelectorAll('h2')]
      .find((h) => h.textContent.trim().toLowerCase() === 'members');
    heading?.scrollIntoView({ block: 'start' });
  })()`);
  await Bun.sleep(500);
  await page.shot('19-members.png');

  await page.eval(`(() => {
    const heading = [...document.querySelectorAll('h2')]
      .find((h) => h.textContent.trim().toLowerCase() === 'activity');
    heading?.scrollIntoView({ block: 'start' });
  })()`);
  await Bun.sleep(500);
  await page.shot('20-activity-feed.png');
}

/**
 * The forgotten-password flow, end to end.
 *
 * The reset token is read out of the database rather than scraped from the
 * API's console output: the console driver is the dev default, but parsing a
 * log for a credential is fragile, and the token hash is all the database
 * holds. So this issues its own token through the same helper the route uses,
 * which is also what a person clicking a real link would end up with.
 */
async function captureRecovery(page: Page) {
  console.log('\nAccount recovery');

  await page.goto(`${WEB}/login`);
  await page.waitFor('document.querySelector(\'input[type="email"]\')');

  // The entry point: a link on the sign-in form.
  await page.clickText('a', 'Forgot your password');
  await page.waitForText('reset your password');
  await page.fill('#forgot-email', EMAIL);
  await page.shot('24-forgot-password.png');

  await page.clickText('button', 'Send reset link');
  await page.waitForText('check your email');
  await page.shot('25-forgot-password-sent.png');

  // A real token for the seeded account, issued the same way the route does.
  const { db, close } = createDatabase(DATABASE_URL);
  let token: string;
  try {
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
    if (!owner) throw new Error(`no seeded account for ${EMAIL}`);
    token = (await issueAuthToken(db, owner.id, 'password_reset')).token;
  } finally {
    await close();
  }

  await page.goto(`${WEB}/reset-password?token=${encodeURIComponent(token)}`);

  try {
    await page.waitForText('choose a new password', 8000);

    // Shown mid-validation, so the inline mismatch error is visible rather
    // than a blank form.
    await page.fill('#reset-password', 'a-strong-enough-password');
    await page.fill('#reset-confirm', 'a-strong-enough-passwo');
    await page.shot('26-reset-password.png');
  } catch {
    console.warn(
      '  skipping 26-reset-password.png - the form did not pick up the token.\n' +
        '  It renders correctly on a cold navigation; something in this run\n' +
        '  reaches it without the query. Worth chasing, not worth blocking on.',
    );
  }

  // The token is left unspent: redeeming it would change the demo password.
}

/** The confirmation page, reached with a link that has already been used. */
async function captureVerifyEmail(page: Page) {
  console.log('\nEmail verification');

  const { db, close } = createDatabase(DATABASE_URL);
  let token: string;
  try {
    const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, EMAIL));
    if (!owner) throw new Error(`no seeded account for ${EMAIL}`);
    token = (await issueAuthToken(db, owner.id, 'email_verification')).token;
  } finally {
    await close();
  }

  await page.goto(`${WEB}/verify-email?token=${encodeURIComponent(token)}`);

  try {
    await page.waitForText('confirm my address', 8000);
    await page.clickText('button', 'Confirm my address');
    await page.waitForText('address confirmed', 8000);
    await page.shot('27-verify-email.png');
  } catch {
    console.warn('  skipping 27-verify-email.png - the page did not pick up the token.');
  }
}

async function captureAccount(page: Page) {
  console.log('\nAccount');
  await page.goto(`${WEB}/account`);
  await page.waitForText('active sessions');
  await page.shot('23-account.png');
}

/**
 * Run the background jobs this script's actions enqueued.
 *
 * Notifications are delivered by the worker, so without this the inbox would
 * be empty in the screenshot -- the comment is written but the mention has not
 * been turned into a notification yet. Driving the runner directly keeps the
 * whole capture to one command instead of requiring a worker process.
 */
async function drainJobs(options: { nudge?: boolean } = {}) {
  const { db, close } = createDatabase(DATABASE_URL);

  try {
    const runner = new Runner({ db, handlers });

    // A few ticks: delivering one job can enqueue another.
    for (let i = 0; i < 5; i++) {
      const { claimed } = await runner.tick();
      if (claimed === 0) break;
    }

    if (options.nudge) await scanNudges(db);
  } finally {
    await close();
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

await preflight();
await mkdir(SHOTS, { recursive: true });

console.log('Re-seeding so the screenshots show the same content every time.');
const seed = Bun.spawnSync(['bun', 'run', 'scripts/seed.ts'], { stdout: 'pipe', stderr: 'pipe' });
if (seed.exitCode !== 0) {
  console.error(seed.stderr.toString());
  process.exit(1);
}

const chrome = Bun.spawn(
  [
    findChrome(),
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank',
  ],
  { stdout: 'ignore', stderr: 'ignore' },
);

let page: Page | null = null;

try {
  // Wait for the debugging endpoint.
  let target: Target | undefined;
  for (let i = 0; i < 80; i++) {
    try {
      target = (await listTargets(CDP_PORT)).find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* not listening yet */
    }
    await Bun.sleep(250);
  }
  if (!target) throw new Error('Chrome never exposed a page target');

  page = await Page.attach(target, cdp);

  const { workspaceUrl, boardUrl } = await captureBasics(page);
  const workspaceId = workspaceUrl.split('/workspaces/')[1]!.split(/[/?#]/)[0]!;

  await captureRealtime(page, boardUrl);
  await captureOffline(page, boardUrl);

  const issueUrl = await captureIssue(page, boardUrl);
  await captureMention(page, issueUrl);
  await drainJobs();

  await captureDocuments(page, workspaceUrl);
  await captureThemes(page, workspaceUrl, boardUrl);
  await captureGuides(page, workspaceId);
  await captureSearch(page, workspaceUrl);
  await captureMembersAndActivity(page, workspaceUrl);
  // Nudges before either inbox shot, so both show real content rather than an
  // empty panel.
  await drainJobs({ nudge: true });
  await captureInbox(page);
  await captureNudge(page, workspaceUrl);
  await captureRecovery(page);
  await captureVerifyEmail(page);
  await captureAccount(page);

  console.log('\nDone.');
} finally {
  page?.close();
  chrome.kill();
  await chrome.exited;
}
