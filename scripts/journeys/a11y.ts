/**
 * Accessibility on every page the screenshot script captures (C9), checked
 * with axe-core (MPL 2.0, see THIRD_PARTY_NOTICES.md): the WCAG 2.1 A and AA
 * rules, and any serious or critical finding fails the check, naming the
 * rule and where it was found. Pages are checked signed out, signed in, and
 * on the light and a dark theme, since contrast is a matter of theme.
 */

import type { Page } from '../capture/cdp.ts';
import { WAIT_MS } from '../smoke/browser-input.ts';
import { startChrome, WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, join, leave, type Person, person, project } from './people.ts';

const AXE = await Bun.file(Bun.resolveSync('axe-core/axe.min.js', import.meta.dir)).text();

type Finding = { id: string; impact: string; help: string; targets: string[] };

/** The serious and critical findings on the page as it stands. */
async function audit(page: Page): Promise<Finding[]> {
  const loaded = await page.eval<boolean>('typeof window.axe === "object"');
  if (!loaded) await page.eval(`${AXE};true`);
  return page.eval<Finding[]>(`(async () => {
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      resultTypes: ['violations'],
    });
    return result.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
  })()`);
}

const describe = (findings: Finding[]) =>
  findings.map((f) => `${f.id} (${f.impact}): ${f.help} at ${f.targets.join(' | ')}`).join('; ');

async function check(checks: Checks, page: Page, name: string, path: string, ready = 'main, h1') {
  await page.goto(`${WEB}${path}`);
  await page.waitFor(
    `document.readyState === 'complete' && !!document.querySelector(${JSON.stringify(ready)})`,
    WAIT_MS,
  );
  // Let entrances finish: a half-faded element is measured at its passing colour.
  await Bun.sleep(900);
  const findings = await audit(page);
  checks.check(
    `${name} has no serious accessibility problems`,
    findings.length === 0,
    describe(findings),
  );
}

/** The page as it stands, after something on it was opened. */
async function checkHere(checks: Checks, page: Page, name: string) {
  await Bun.sleep(700);
  const findings = await audit(page);
  checks.check(
    `${name} has no serious accessibility problems`,
    findings.length === 0,
    describe(findings),
  );
}

const click = (page: Page, text: string) =>
  page.eval(
    `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click()`,
  );

/** Animation frames the page asks for in two seconds. */
async function framesIn(page: Page): Promise<number> {
  await page.eval('window.__frames = 0; true');
  await Bun.sleep(2000);
  return page.eval<number>('window.__frames');
}

/**
 * The landing page's WebGL field under reduced motion (C9): it draws one
 * still frame and asks for no more, and turning reduced motion on with the
 * page open stills it too.
 */
async function reducedMotion(checks: Checks, page: Page) {
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__frames = 0; const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__frames++; return raf(cb); };`,
  });
  const motion = (value: 'reduce' | 'no-preference') =>
    page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value }],
    });
  await motion('no-preference');
  await page.goto(`${WEB}/`);
  await page.waitFor('!!document.querySelector("canvas")', WAIT_MS);
  await Bun.sleep(1000);
  const moving = await framesIn(page);
  await motion('reduce');
  await Bun.sleep(500);
  const stilled = await framesIn(page);
  checks.check(
    'the landing field moves, and stops when reduced motion is turned on',
    moving > 30 && stilled < 5,
    `${moving} frames moving, ${stilled} after`,
  );
  await page.goto(`${WEB}/`);
  await page.waitFor('!!document.querySelector("canvas")', WAIT_MS);
  await Bun.sleep(1000);
  const fromTheStart = await framesIn(page);
  checks.check(
    'and stays still when it was on from the start',
    fromTheStart < 5,
    `${fromTheStart} frames`,
  );
  await motion('no-preference');
}

async function signedOut(checks: Checks, port: number) {
  const { page, stop } = await startChrome(port, 'a11y-out');
  try {
    await reducedMotion(checks, page);
    await check(checks, page, 'the landing page', '/');
    await check(checks, page, 'sign in', '/login', 'form');
    await check(checks, page, 'sign up', '/signup');
    await check(checks, page, 'a forgotten password', '/forgot-password');
    await check(checks, page, 'resetting a password', '/reset-password?token=not-a-real-token');
    await check(checks, page, 'verifying an address', '/verify-email?token=not-a-real-token');
  } finally {
    page.close();
    stop();
  }
}

export async function a11yJourney(checks: Checks, ports: readonly [number, number, number]) {
  process.stdout.write('Accessibility on every captured page\n');
  await signedOut(checks, ports[2]);
  let owner: Person | undefined;
  let member: Person | undefined;
  try {
    owner = await person(ports[0], 'axeowner');
    member = await person(ports[1], 'axemember');
    await join(owner, member, 'MEMBER');
    const { page, workspaceId } = owner;
    const projectId = await project(owner, 'Checked');
    const { issue } = await api<{ issue: { id: string } }>(
      page,
      `/workspaces/${workspaceId}/projects/${projectId}/issues`,
      'POST',
      { title: 'Every control has a name', priority: 'HIGH' },
    );
    await api(page, `/workspaces/${workspaceId}/issues/${issue.id}/comments`, 'POST', {
      body: `@${member.username} can you check the contrast?`,
    });
    const { document } = await api<{ document: { id: string } }>(
      page,
      `/workspaces/${workspaceId}/documents`,
      'POST',
      { title: 'Notes' },
    );
    const ws = `/workspaces/${workspaceId}`;

    for (const theme of ['midnight', 'daylight', 'mist', 'forest']) {
      await api(page, ws, 'PATCH', { theme });
      const on = `on ${theme}`;
      await check(checks, page, `home ${on}`, '/workspaces');
      await check(checks, page, `the board ${on}`, `${ws}/projects/${projectId}`);
      await check(checks, page, `an issue ${on}`, `${ws}/issues/${issue.id}`);
    }
    await api(page, ws, 'PATCH', { theme: 'midnight' });
    // As the screenshots show them: a description being written.
    await check(checks, page, 'an issue', `${ws}/issues/${issue.id}`);
    await click(page, 'Add a description');
    await checkHere(checks, page, 'an issue with its description being written');
    await check(checks, page, 'a document', `${ws}/documents/${document.id}`);
    await check(checks, page, 'a guide', `/guide/try_document?w=${workspaceId}`);
    await check(checks, page, 'search', `${ws}/search?q=contrast`);
    await check(checks, page, 'people', `${ws}/people`);
    await check(checks, page, 'activity', `${ws}/activity`);
    await check(checks, page, 'meetings', `${ws}/meetings`);
    await check(checks, page, 'the feed', `${ws}/feed`);
    await check(checks, page, 'spaces', `${ws}/spaces`);
    await check(checks, page, 'the calendar', `${ws}/calendar`);
    await check(checks, page, 'insights', `${ws}/insights`);
    await check(checks, page, 'releases', `${ws}/releases`);
    await check(checks, page, 'automations', `${ws}/automations`);
    await check(checks, page, 'account', '/account');
    await check(checks, page, 'the first run', '/first-run');
    // The member's inbox, with the mention waiting in it.
    await member.page.goto(`${WEB}/workspaces`);
    await check(checks, member.page, 'home with a mention waiting', '/workspaces');
    await click(member.page, 'Inbox');
    await checkHere(checks, member.page, 'the inbox, open');
  } finally {
    leave([owner, member]);
  }
}
