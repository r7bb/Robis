/**
 * Sign-up through the pages, end to end: an address typed into the form,
 * the link read from the mail sink, the account finished on the page that
 * link opens, a picture chosen, and a first workspace made. Nothing here
 * calls the API directly.
 */

import { focus, press, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { startChrome, WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';

const MAIL = process.env.SMOKE_MAIL_URL ?? 'http://127.0.0.1:8025';
const MAIL_POLL_MS = 500;

/** The sign-up link mailed to `email`, as the sink holds it. */
async function mailedLink(email: string): Promise<string | null> {
  const deadline = Date.now() + WAIT_MS * 2;
  while (Date.now() < deadline) {
    const { messages } = (await (await fetch(`${MAIL}/messages`)).json()) as {
      messages: { to: string[]; text: string }[];
    };
    const text = messages.find((message) => message.to.includes(email))?.text;
    const link = text && /https?:\/\/\S+\/signup\?token=\S+/.exec(text)?.[0];
    if (link) return link;
    await Bun.sleep(MAIL_POLL_MS);
  }
  return null;
}

/** The link as this browser reaches the stack, whatever origin the mail names. */
const onThisStack = (link: string) => {
  const url = new URL(link);
  return `${WEB}${url.pathname}${url.search}`;
};

export async function signupJourney(checks: Checks, port: number) {
  process.stdout.write('Sign-up with email verification\n');
  const { page, stop } = await startChrome(port, 'journey-signup');
  try {
    const run = Date.now().toString(36);
    const email = `journey-${run}@robis.test`;

    await page.goto(`${WEB}/login?mode=register`);
    await page.fill('input[type=email]', email);
    await page.clickText('button[type=submit]', 'Send me a link');
    checks.check(
      'the form says a link was sent',
      await waitUntil(page, `document.body.innerText.includes(${JSON.stringify(email)})`),
    );

    const link = await mailedLink(email);
    if (!checks.check('the link arrives in the mail sink', link !== null)) return;

    await page.goto(onThisStack(link!));
    await page.fill('input[autocomplete=name]', 'Journey Tester');
    await page.fill('input[autocomplete=username]', `journey_${run}`);
    await page.fill('input[type=password]', `journey-password-${run}`);
    await page.click('input[type=checkbox]');
    await page.clickText('button[type=submit]', 'Create account');

    const pictured = await waitUntil(page, `location.pathname.startsWith('/welcome')`);
    checks.check('a new account is asked for a picture first', pictured);
    await page.clickText('[role=tab]', 'Pick a pattern');
    await page.click('button[aria-label="Use this pattern"]');
    checks.check(
      'a pattern is chosen',
      await waitUntil(
        page,
        `!!document.querySelector('button[aria-label="Use this pattern"][aria-pressed=true]')`,
      ),
    );
    await page.clickText('button', 'Continue');

    const home = await waitUntil(
      page,
      `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'New workspace')`,
    );
    checks.check(
      'the picture chosen, the workspaces page opens',
      home,
      `${await page.eval('location.pathname')}: ${(await page.text()).slice(0, 300)}`,
    );
    if (!home) return;
    await page.clickText('button', 'New workspace');
    await page.waitFor(`!!document.querySelector('#new-workspace-name')`);
    await focus(page, '#new-workspace-name');
    const name = `Journey ${run}`;
    await typeText(page, name);
    await press(page, 'Enter');
    const tile = `[...document.querySelectorAll('a[href^="/workspaces/"]')].find((a) => a.textContent.includes(${JSON.stringify(name)}))`;
    checks.check('a first workspace is made', await waitUntil(page, `!!(${tile})`));
    await page.eval(`${tile}?.click()`);
    const inside = await waitUntil(
      page,
      `/^\\/workspaces\\/[0-9a-f-]{36}/.test(location.pathname)`,
    );
    checks.check('and opens', inside, await page.eval('location.pathname'));
  } finally {
    page.close();
    stop();
  }
}
