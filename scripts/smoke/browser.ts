/**
 * Browser smoke test against a running stack: `bun run smoke:browser`.
 *
 * Loads the web app in a real headless Chrome under its own security
 * policy (stage 1, item 5): the landing with its WebGL field, the sign-in,
 * sign-up and intro pages, and a signed-in workspace that talks to the API
 * and the gateway. Fails on any Content-Security-Policy violation, on a
 * page that does not hydrate, or on a missing security header, and proves
 * the policy bites: a script or handler injected into the page must not run.
 *
 * The first piece of the browser suite (track E1). Uses only Bun and the
 * repository's CDP helper, which itself imports only Node built-ins.
 */

import type { Page } from '../capture/cdp.ts';
import { signUpInBrowser, startChrome, WEB } from './browser-session.ts';
import { PageTrouble } from './page-trouble.ts';

const PORT = Number(process.env.SMOKE_CDP_PORT ?? 9487);
/** Long enough for a signed-in page to fetch its data and open its socket. */
const SETTLE_MS = 3_000;

const PUBLIC_PAGES = ['/', '/login', '/start', '/how-it-works', '/whats-new', '/signup'];

/** Runs before any page script, which CSP does not block: DevTools injects it. */
const RECORD_VIOLATIONS = `
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__violations.push(e.violatedDirective + ' ' + (e.blockedURI || 'inline') + ' ' + (e.sourceFile || ''));
  });
`;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  process.stdout.write(`  ${ok ? 'ok ' : 'NOT'} ${name}${ok || !detail ? '' : `: ${detail}`}\n`);
}

async function headersOf(path: string) {
  const response = await fetch(`${WEB}${path}`, { redirect: 'manual' });
  return response.headers;
}

function checkHeaders(path: string, headers: Headers) {
  const policy = headers.get('content-security-policy') ?? '';
  check(
    `${path}: a nonce policy`,
    /script-src [^;]*'nonce-[^']+'[^;]*'strict-dynamic'/.test(policy),
    policy,
  );
  check(
    `${path}: no inline scripts allowed`,
    !/script-src [^;]*'unsafe-inline'/.test(policy),
    policy,
  );
  check(`${path}: nothing may frame it`, policy.includes("frame-ancestors 'none'"), policy);
  check(`${path}: no sniffing`, headers.get('x-content-type-options') === 'nosniff');
  check(
    `${path}: camera for this origin only`,
    (headers.get('permissions-policy') ?? '').includes('camera=(self)'),
  );
  // The web image is a production build, wherever it runs.
  check(
    `${path}: HTTPS pinned`,
    (headers.get('strict-transport-security') ?? '').startsWith('max-age='),
  );
}

/**
 * Each response has its own nonce, and it is the one on the page's scripts:
 * the two things the per-request rendering in the root layout is for.
 */
async function checkNonces() {
  const load = async () => {
    const response = await fetch(`${WEB}/login`);
    const nonce = /'nonce-([^']+)'/.exec(
      response.headers.get('content-security-policy') ?? '',
    )?.[1];
    return { nonce, html: await response.text() };
  };
  const [first, second] = [await load(), await load()];
  check('a fresh nonce on every response', !!first.nonce && first.nonce !== second.nonce);
  check(
    "and it is the one on the page's scripts",
    !!first.nonce && first.html.includes(`nonce="${first.nonce}"`),
  );
}

const HYDRATED =
  "[...document.querySelectorAll('body *')].some((el) => Object.keys(el).some((k) => k.startsWith('__react')))";

/**
 * Load a page and report what the policy blocked, and whether React ran:
 * how long it took, and if it did not, what the page was doing instead.
 */
async function visit(page: Page, path: string, trouble: PageTrouble) {
  trouble.reset();
  const began = performance.now();
  await page.goto(`${WEB}${path}`);
  await page.waitFor(HYDRATED, 15_000).catch(() => undefined);
  const hydrated = await page.eval<boolean>(HYDRATED);
  const seconds = ((performance.now() - began) / 1000).toFixed(1);
  check(`${path}: hydrated (${seconds} s)`, hydrated, hydrated ? '' : await trouble.describe(page));
  const violations = await page.eval<string[]>('window.__violations');
  check(`${path}: no policy violations`, violations.length === 0, violations.join(' | '));
}

type FetchPaused = {
  requestId: string;
  responseStatusCode: number;
  responseHeaders: { name: string; value: string }[];
};

/** What a stored cross-site script would put in the page. */
const INJECTION =
  '<script>window.__ranScript = true</script>' +
  '<img src="data:image/png;base64,AAAA" onerror="window.__ranHandler = true">';

/** Serve the paused page with the injection in it, headers untouched. */
async function injectInto(page: Page, paused: FetchPaused) {
  const { body, base64Encoded } = await page.send<{ body: string; base64Encoded: boolean }>(
    'Fetch.getResponseBody',
    { requestId: paused.requestId },
  );
  const html = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  await page.send('Fetch.fulfillRequest', {
    requestId: paused.requestId,
    responseCode: paused.responseStatusCode,
    responseHeaders: paused.responseHeaders,
    body: Buffer.from(html.replace(/<body([^>]*)>/, `<body$1>${INJECTION}`)).toString('base64'),
  });
}

async function main() {
  process.stdout.write(`Browser smoke test against ${WEB}\n`);
  const { page, stop } = await startChrome(PORT, 'browser-smoke');

  try {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORD_VIOLATIONS });
    const trouble = new PageTrouble(page);

    for (const path of PUBLIC_PAGES) {
      checkHeaders(path, await headersOf(path));
      await visit(page, path, trouble);
    }
    // A page that does not exist is still a page.
    checkHeaders('a missing page', await headersOf('/no-such-page'));
    await checkNonces();

    // The landing's WebGL field must still draw under the policy. Its own
    // code links a program into the context; a context made here would have
    // none, so this cannot pass on a page whose scripts did not run.
    await page.goto(`${WEB}/`);
    const PROGRAM_IN_USE = `(() => {
      const gl = document.querySelector('canvas')?.getContext('webgl');
      return !!gl && !gl.isContextLost() && gl.getParameter(gl.CURRENT_PROGRAM) !== null;
    })()`;
    await page.waitFor(PROGRAM_IN_USE, 10_000).catch(() => undefined);
    check('/: the WebGL field is drawing', await page.eval<boolean>(PROGRAM_IN_USE));
    const landing = await page.eval<string[]>('window.__violations');
    check('/: still no violations once it draws', landing.length === 0, landing.join(' | '));

    // The policy bites. Markup injected into the page as served, as a
    // stored cross-site script would be, must not run. (Script the page
    // itself runs may add more: that is what 'strict-dynamic' trusts.)
    // The app's service worker fetches navigations itself, out of reach of
    // the page's interception; this one load goes to the network.
    await page.send('Network.setBypassServiceWorker', { bypass: true });
    await page.send('Fetch.enable', {
      patterns: [{ urlPattern: '*inject=1*', resourceType: 'Document', requestStage: 'Response' }],
    });
    page.on<FetchPaused>('Fetch.requestPaused', (paused) => {
      injectInto(page, paused).catch((error: unknown) => {
        check('the page could be rewritten', false, String(error));
      });
    });
    await page.goto(`${WEB}/login?inject=1`);
    await Bun.sleep(500);
    const injected = await page.eval<{
      present: boolean;
      script: boolean;
      handler: boolean;
      blocked: string[];
    }>(
      '({ present: !!document.querySelector("img[onerror]"), script: !!window.__ranScript, handler: !!window.__ranHandler, blocked: window.__violations })',
    );
    await page.send('Fetch.disable');
    await page.send('Network.setBypassServiceWorker', { bypass: false });
    check('the injected markup reached the page', injected.present);
    check('an injected inline script does not run', !injected.script);
    check('an injected inline handler does not run', !injected.handler);
    check(
      'and the browser reports both as blocked',
      injected.blocked.filter((v) => v.startsWith('script-src')).length >= 2,
      injected.blocked.join(' | '),
    );

    // Signed in: the workspace loads data from the API and joins the gateway.
    // From an ordinary page, not the rewritten one.
    await page.goto(`${WEB}/login`);
    const workspaceId = await signUpInBrowser(page, 'browser');
    // The signed-in home: the field, the overview and a live connection per workspace.
    await page.send('Runtime.evaluate', { expression: 'window.__violations = []' });
    await visit(page, '/workspaces', trouble);
    await Bun.sleep(SETTLE_MS);
    check(
      'the home shows the workspace, live',
      await page.eval<boolean>(
        "document.querySelectorAll('.home-tile').length === 1 && document.body.textContent.includes('Connected')",
      ),
    );
    const home = await page.eval<string[]>('window.__violations');
    check('the home, once settled: no violations', home.length === 0, home.join(' | '));

    await page.send('Runtime.evaluate', { expression: 'window.__violations = []' });
    await visit(page, `/workspaces/${workspaceId}`, trouble);
    // Its API calls and the gateway socket start after hydration; a wrong
    // connect-src shows up only once they have run.
    await Bun.sleep(SETTLE_MS);
    const settled = await page.eval<string[]>('window.__violations');
    check(
      'the workspace page, once settled: no violations',
      settled.length === 0,
      settled.join(' | '),
    );
    const shown = await page.eval<boolean>("document.body.textContent.includes('Browser')");
    check('the workspace page shows the workspace', shown);
    page.close();
  } finally {
    stop();
  }

  if (failures > 0) {
    process.stderr.write(`Browser smoke test failed: ${failures} check(s).\n`);
    process.exit(1);
  }
  process.stdout.write('Browser smoke test passed.\n');
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Browser smoke test failed. ${error instanceof Error ? error.message : error}\n`,
  );
  process.exit(1);
}
