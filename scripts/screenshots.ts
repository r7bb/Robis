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
 *   bun run dev:api / dev:realtime / dev:web
 *
 * It re-seeds first, so the images are of the same content every time rather
 * than whatever happened to be in the database.
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '@relay/database';
import { handlers } from '@relay/worker/handlers';
import { scanNudges } from '@relay/worker/nudges';
import { Runner } from '@relay/worker/runner';

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

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

// ---------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------

type Target = { id: string; type: string; url: string; webSocketDebuggerUrl: string };

/**
 * One browser tab.
 *
 * Every request carries a timeout. A dropped CDP response is otherwise
 * indistinguishable from a slow one, and the script hangs forever instead of
 * failing -- which is exactly what happened while this was being written.
 */
class Page {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  private constructor(
    private readonly socket: WebSocket,
    readonly targetId: string,
  ) {}

  static async attach(target: Target): Promise<Page> {
    const socket = new WebSocket(target.webSocketDebuggerUrl);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP socket did not open')), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP socket failed'));
      });
    });

    const page = new Page(socket, target.id);

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiting = message.id !== undefined ? page.pending.get(message.id) : undefined;
      if (!waiting) return;

      page.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message ?? 'CDP error'));
      else waiting.resolve(message.result);
    });

    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });

    return page;
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 20_000,
  ): Promise<T> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T>(expression: string): Promise<T> {
    const result = await this.send<{
      result?: { value?: unknown };
      exceptionDetails?: { exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });

    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }

    return result.result?.value as T;
  }

  async goto(url: string) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"');
    await Bun.sleep(700);
  }

  /** Poll a JavaScript predicate until it holds. */
  async waitFor(expression: string, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.eval<boolean>(`!!(${expression})`)) return;
      await Bun.sleep(150);
    }

    // Report what the page was actually showing. "Timed out" on its own sends
    // you back to re-run the whole capture just to find out where you were.
    const where = await this.eval<string>('location.href').catch(() => '<unreachable>');
    const body = await this.text().catch(() => '<no body>');

    throw new Error(
      `timed out waiting for: ${expression}\n  url: ${where}\n  body: ${body.slice(0, 400).replace(/\n+/g, ' | ')}`,
    );
  }

  /** Wait for text, tolerating the uppercase that CSS applies to headings. */
  waitForText(text: string, timeoutMs = 20_000) {
    return this.waitFor(
      `document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
      timeoutMs,
    );
  }

  text(): Promise<string> {
    return this.eval<string>('document.body.innerText');
  }

  async click(selector: string) {
    const clicked = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.click();
      return true;
    })()`);

    if (!clicked) throw new Error(`nothing matched ${selector}`);
    await Bun.sleep(450);
  }

  /** Click the first element whose text contains `label`. */
  async clickText(selector: string, label: string) {
    const clicked = await this.eval<boolean>(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => n.textContent.toLowerCase().includes(${JSON.stringify(label.toLowerCase())}));
      if (!el) return false;
      el.click();
      return true;
    })()`);

    if (!clicked) throw new Error(`no ${selector} containing "${label}"`);
    await Bun.sleep(450);
  }

  /**
   * Set a value on a React-controlled field.
   *
   * React tracks the previous value on the DOM node and ignores an event whose
   * value it believes it already has, so the native setter has to be called
   * rather than assigning `.value` directly.
   */
  async fill(selector: string, value: string) {
    const filled = await this.eval<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);

    if (!filled) throw new Error(`no field matched ${selector}`);
    await Bun.sleep(300);
  }

  /** Cut the network at the browser, which is what `navigator.onLine` reads. */
  setOffline(offline: boolean) {
    return this.send('Network.emulateNetworkConditions', {
      offline,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  async shot(name: string) {
    // Let any in-flight transition settle, so nothing is caught mid-fade.
    await Bun.sleep(400);
    const { data } = await this.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
    });
    await Bun.write(`${SHOTS}${name}`, Buffer.from(data, 'base64'));
    console.log(`  ${name}`);
  }

  close() {
    this.socket.close();
  }
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

function findChrome(): string {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No Chrome found. Looked in:\n${CHROME_CANDIDATES.map((p) => `  ${p}`).join('\n')}`,
    );
  }
  return found;
}

async function listTargets(): Promise<Target[]> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
  return (await response.json()) as Target[];
}

/** Open a second tab, for the screenshots that need two windows. */
async function openTab(url: string): Promise<Page> {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  const target = (await response.json()) as Target;

  // The freshly created target is not always in /json immediately.
  for (let i = 0; i < 40; i++) {
    const match = (await listTargets()).find((t) => t.id === target.id);
    if (match?.webSocketDebuggerUrl) return Page.attach(match);
    await Bun.sleep(150);
  }

  throw new Error('new tab never appeared');
}

/**
 * Close a tab by its target id.
 *
 * Not by url: both tabs sit on the same origin, so matching on a prefix can
 * close the main one and leave the rest of the run driving a dead page.
 */
async function closeTab(page: Page) {
  const id = page.targetId;
  page.close();
  await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${id}`);
  await Bun.sleep(300);
}

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
  const other = await openTab(boardUrl);

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
    await closeTab(other);
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
  const other = await openTab(documentUrl);

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
    await closeTab(other);
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
      target = (await listTargets()).find((t) => t.type === 'page');
      if (target) break;
    } catch {
      /* not listening yet */
    }
    await Bun.sleep(250);
  }
  if (!target) throw new Error('Chrome never exposed a page target');

  page = await Page.attach(target);

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
  await captureAccount(page);

  console.log('\nDone.');
} finally {
  page?.close();
  chrome.kill();
  await chrome.exited;
}
