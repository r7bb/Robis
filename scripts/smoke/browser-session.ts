/**
 * What the browser smoke tests share: a headless Chrome to drive, and a
 * fresh account signed up through the real flow (mail link and all) with a
 * workspace of its own. Only Bun and the repository's CDP helper.
 */

import { findChrome, listTargets, Page } from '../capture/cdp.ts';

// The API as the web app was built to reach it: the only one its policy allows.
export const WEB_API = process.env.SMOKE_WEB_API_URL ?? '/api';
const MAIL = process.env.SMOKE_MAIL_URL ?? 'http://127.0.0.1:8025';
const WEB_PORT = process.env.STACK_WEB_PORT ?? 3000;
// `localhost`, as the stack's WEB_ORIGIN names it; Chrome is told it means
// 127.0.0.1 so another program on [::1] cannot answer instead.
export const WEB = process.env.SMOKE_WEB_URL ?? `http://localhost:${WEB_PORT}`;
// From this script (not the page): the proxy, by address, so nothing else on
// [::1] answers for localhost.
const API = process.env.SMOKE_API_URL ?? `http://127.0.0.1:${WEB_PORT}/api`;
const MAIL_WAIT_MS = 30_000;
/** Polls of 200 ms each for Chrome's debugging port: a minute in all. */
const CHROME_START_POLLS = 300;

/** Start Chrome and attach to its first tab. `stop` ends it. */
export async function startChrome(port: number, name: string) {
  const chrome = Bun.spawn(
    [
      findChrome(),
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/robis-${name}-${Date.now()}`,
      '--host-resolver-rules=MAP localhost 127.0.0.1',
      '--no-first-run',
      // WebGL in a headless runner with no GPU.
      '--enable-unsafe-swiftshader',
      ...(process.env.CI ? ['--no-sandbox'] : []),
      // The production-mode CI stack serves a throwaway certificate.
      ...(process.env.SMOKE_IGNORE_CERT_ERRORS === '1' ? ['--ignore-certificate-errors'] : []),
      'about:blank',
    ],
    { stdout: 'ignore', stderr: 'pipe' },
  );
  // Read as it comes, so a full pipe never stalls Chrome; shown if it fails.
  const chromeLog = new Response(chrome.stderr).text();

  let target: Awaited<ReturnType<typeof listTargets>>[number] | undefined;
  // A cold start on a CI runner can take a while.
  for (let i = 0; i < CHROME_START_POLLS && !target && chrome.exitCode === null; i++) {
    await Bun.sleep(200);
    target = await listTargets(port)
      .then((all) => all.find((t) => t.type === 'page'))
      .catch(() => undefined);
  }
  if (!target) {
    chrome.kill();
    const output = await chromeLog;
    throw new Error(`Chrome did not start (exit ${chrome.exitCode}):\n${output.slice(-2000)}`);
  }
  const page = await Page.attach(target, {
    port,
    shotsDir: `${process.env.TMPDIR ?? '/tmp'}/`,
    width: 1280,
    height: 860,
    scale: 1,
  });
  return { page, stop: () => chrome.kill() };
}

async function mailedLink(email: string) {
  const deadline = Date.now() + MAIL_WAIT_MS;
  while (Date.now() < deadline) {
    const { messages } = (await (await fetch(`${MAIL}/messages`)).json()) as {
      messages: { to: string[]; text: string }[];
    };
    const text = messages.find((m) => m.to.includes(email))?.text;
    const link = text && /https?:\/\/\S+\/signup\?token=\S+/.exec(text)?.[0];
    if (link) return link;
    await Bun.sleep(500);
  }
  throw new Error(`no sign-up mail for ${email}`);
}

/** Call the API from the page, so the session cookie is the browser's. */
export function pageCall(page: Page, path: string, method: string, body?: unknown) {
  return page.eval<{ status: number; json: unknown } | string>(`fetch(${JSON.stringify(
    `${WEB_API}${path}`,
  )}, {
      method: ${JSON.stringify(method)}, credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ${body === undefined ? '' : `body: ${JSON.stringify(JSON.stringify(body))},`}
    }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }),
            (e) => 'failed: ' + e.message)`);
}

/**
 * Sign up through the API, from the page, so the session cookie is the
 * browser's; then a workspace of its own. Returns the workspace id.
 */
export async function signUpInBrowser(page: Page, label: string): Promise<string> {
  const run = Date.now().toString(36);
  const email = `${label}-${run}@robis.test`;
  const started = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (started.status !== 202) throw new Error(`sign-up start: ${started.status}`);
  const token = new URL(await mailedLink(email)).searchParams.get('token');

  const status = async (path: string, method: string, body: unknown) => {
    const result = await pageCall(page, path, method, body);
    return typeof result === 'string' ? result : result.status;
  };
  const registered = await status('/auth/register', 'POST', {
    token,
    name: 'Browser Test',
    username: `${label}_${run}`,
    password: `${label}-password-${run}`,
    ageConfirmed: true,
  });
  if (registered !== 201) throw new Error(`register: ${registered}`);
  const me = await pageCall(page, '/auth/me', 'GET');
  const current =
    typeof me === 'string'
      ? ''
      : (me.json as { user: { consent: { current: string } } }).user.consent.current;
  await status('/auth/me/consent', 'POST', { termsVersion: current, ageConfirmed: true });
  await status('/auth/me/avatar/generated', 'PUT', { seed: run });
  const workspace = await pageCall(page, '/workspaces', 'POST', {
    name: 'Browser',
    slug: `${label}-${run}`,
  });
  const id =
    typeof workspace === 'string'
      ? undefined
      : (workspace.json as { workspace?: { id: string } }).workspace?.id;
  if (!id) throw new Error(`workspace: ${JSON.stringify(workspace)}`);
  return id;
}
