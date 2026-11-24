/**
 * Choosing a language (C9): Spanish on the account page turns the sidebar
 * and the calendar into Spanish, sets the page's lang for screen readers,
 * writes dates the Spanish way, and stays chosen after a reload. Following
 * the browser again brings English back.
 */

import type { Page } from '../capture/cdp.ts';
import { WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { leave, type Person, person } from './people.ts';

/** Pick an option in the language select as a person would, through React's change event. */
const pick = (page: Page, value: string) =>
  page.eval(`(() => {
    const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'es'));
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

export async function languagesJourney(checks: Checks, port: number) {
  process.stdout.write('Choosing a language\n');
  let someone: Person | undefined;
  try {
    someone = await person(port, 'languages');
    const { page, workspaceId } = someone;
    await page.goto(`${WEB}/account`);
    await page.waitFor(
      `[...document.querySelectorAll('select')].some((s) => [...s.options].some((o) => o.value === 'es'))`,
      WAIT_MS,
    );
    await pick(page, 'es');
    checks.check(
      'choosing Spanish sets the page’s language',
      await waitUntil(page, `document.documentElement.lang === 'es'`),
    );

    const calendar = `${WEB}/workspaces/${workspaceId}/calendar`;
    await page.goto(calendar);
    checks.check(
      'the calendar and the sidebar read in Spanish, dates included, after a reload',
      await waitUntil(
        page,
        `document.documentElement.lang === 'es' && document.querySelector('h1')?.textContent === 'Calendario' && [...document.querySelectorAll('a')].some((a) => a.textContent === 'Espacios') && /Semana \\d+/.test(document.body.textContent) && /(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)/.test(document.querySelector('h2')?.textContent ?? '')`,
      ),
    );

    await page.goto(`${WEB}/account`);
    await page.waitFor(`document.documentElement.lang === 'es'`, WAIT_MS);
    await pick(page, '');
    await page.goto(calendar);
    checks.check(
      'following the browser again brings English back',
      await waitUntil(
        page,
        `document.documentElement.lang === 'en' && document.querySelector('h1')?.textContent === 'Calendar'`,
      ),
    );
  } finally {
    leave([someone]);
  }
}
