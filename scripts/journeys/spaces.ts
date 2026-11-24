/**
 * Spaces, as two people use them: one starts a space and asks a question,
 * the other answers, the asker marks the reply Helpful and as the answer,
 * and the answerer is then the most helpful person in the workspace. Each
 * step is typed and clicked in the page; the asker's open thread shows the
 * reply without being reloaded.
 */

import type { Page } from '../capture/cdp.ts';
import { focus, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { join, leave, type Person, person } from './people.ts';

const QUESTION = 'Why does the VPN drop at noon';
const ANSWER = 'The backup job runs at noon. Move it to midnight.';

const button = (text: string) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

async function click(page: Page, text: string) {
  await page.waitFor(`!!${button(text)}`, WAIT_MS);
  await page.eval(`${button(text)}.click()`);
}

async function typeInto(page: Page, selector: string, text: string) {
  await page.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, WAIT_MS);
  await focus(page, selector);
  await typeText(page, text);
}

export async function spacesJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('Spaces\n');
  let asker: Person | undefined;
  let answerer: Person | undefined;
  try {
    asker = await person(ports[0], 'asker');
    answerer = await person(ports[1], 'answerer');
    await join(asker, answerer, 'MEMBER');
    const ws = `/workspaces/${asker.workspaceId}`;

    // Start a space and ask in it.
    await asker.page.goto(`${WEB}${ws}/spaces`);
    await click(asker.page, 'Start a space');
    await typeInto(asker.page, 'form[aria-label="Start a space"] input', 'IT help');
    await click(asker.page, 'Start the space');
    checks.check(
      'starting a space opens it',
      await waitUntil(
        asker.page,
        `location.pathname.split('/').length === 5 && document.querySelector('h1')?.textContent === 'IT help'`,
      ),
    );
    await asker.page.eval(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Ask a question'))?.click()`,
    );
    await typeInto(asker.page, 'form[aria-label^="Start a thread"] input', QUESTION);
    await click(asker.page, 'Post the thread');
    checks.check(
      'posting a question opens its thread',
      await waitUntil(
        asker.page,
        `location.pathname.includes('/spaces/threads/') && document.querySelector('h1')?.textContent === ${JSON.stringify(QUESTION)}`,
      ),
    );
    const threadPath = await asker.page.eval<string>('location.pathname');

    // The other person answers.
    await answerer.page.goto(`${WEB}${threadPath}`);
    await typeInto(answerer.page, 'textarea[aria-label="Reply to the thread"]', ANSWER);
    await click(answerer.page, 'Reply');
    checks.check(
      'the asker’s open thread shows the reply without a reload',
      await waitUntil(asker.page, `document.body.textContent.includes(${JSON.stringify(ANSWER)})`),
    );

    // Helpful, then the answer.
    await asker.page.eval(
      `document.querySelector('li[id^="reply-"] button[aria-pressed]')?.click()`,
    );
    await click(asker.page, 'Mark as the answer');
    checks.check(
      'the answerer sees the reply marked as the answer, and the thread solved',
      await waitUntil(
        answerer.page,
        `document.body.textContent.includes('The answer') && document.body.textContent.includes('Solved')`,
      ),
    );

    await answerer.page.goto(`${WEB}${ws}/spaces`);
    checks.check(
      'the answerer leads Most helpful',
      await waitUntil(
        answerer.page,
        `(() => { const list = document.querySelector('#most-helpful-heading')?.closest('section')?.querySelector('ol'); return !!list && list.textContent.includes('1 helpful') && list.textContent.includes('1 answer'); })()`,
      ),
    );
  } finally {
    leave([asker, answerer]);
  }
}
