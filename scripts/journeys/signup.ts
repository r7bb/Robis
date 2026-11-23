/**
 * Sign-up through the pages, end to end: an address typed into the form,
 * the link read from the mail sink, the account finished on the page that
 * link opens, a picture chosen, and a first workspace made. Nothing here
 * calls the API directly.
 */

import { WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
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
    // Every click a person would make, counted for C5's done-when; typing
    // into a field is not a click.
    let clicks = 0;
    const click = async (selector: string, label?: string) => {
      clicks++;
      if (label) await page.clickText(selector, label);
      else await page.click(selector);
    };
    const run = Date.now().toString(36);
    const email = `journey-${run}@robis.test`;

    await page.goto(`${WEB}/login?mode=register`);
    await page.fill('input[type=email]', email);
    await click('button[type=submit]', 'Send me a link');
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
    await click('input[type=checkbox]');
    await click('button[type=submit]', 'Create account');

    const pictured = await waitUntil(page, `location.pathname.startsWith('/welcome')`);
    checks.check('a new account is asked for a picture first', pictured);
    await click('[role=tab]', 'Pick a pattern');
    await click('button[aria-label="Use this pattern"]');
    checks.check(
      'a pattern is chosen',
      await waitUntil(
        page,
        `!!document.querySelector('button[aria-label="Use this pattern"][aria-pressed=true]')`,
      ),
    );
    await click('button', 'Continue');

    // The first run (C5): a workspace, its look and a teammate, a project.
    const firstRun = await waitUntil(page, `!!document.querySelector('#first-workspace')`);
    checks.check(
      'the picture chosen, the first run opens',
      firstRun,
      await page.eval('location.pathname'),
    );
    if (!firstRun) return;
    await page.fill('#first-workspace', `Journey ${run}`);
    await click('button[type=submit]', 'Create workspace');
    await page.waitFor(`document.body.innerText.includes('Its look, and a teammate')`, WAIT_MS);
    await click('button', 'Continue');
    await page.waitFor(`!!document.querySelector('#first-project')`, WAIT_MS);
    await click('button[type=submit]', 'Create the project');
    const board = await waitUntil(page, `document.querySelectorAll('[data-card]').length === 5`);
    checks.check(
      'the board opens with its five starter issues',
      board,
      await page.eval('location.pathname'),
    );
    checks.check(`from sign-up to a first issue in under ten clicks (${clicks})`, clicks < 10);
  } finally {
    page.close();
    stop();
  }
}
