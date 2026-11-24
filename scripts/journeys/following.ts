/**
 * A quieter feed: the Following tab starts empty with teammates to follow,
 * following one from there fills it with their posts and nobody else's, the
 * arrow keys move between tabs, and Highlights holds the check-in that used
 * to sit above every post.
 */

import { press, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, join, leave, type Person, person } from './people.ts';

const tab = (name: string) =>
  `[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim().startsWith(${JSON.stringify(name)}))`;

export async function followingJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('A quieter feed\n');
  let reader: Person | undefined;
  let writer: Person | undefined;
  try {
    reader = await person(ports[0], 'reader');
    writer = await person(ports[1], 'writer');
    await join(reader, writer, 'MEMBER');
    const ws = `/workspaces/${reader.workspaceId}`;
    await api(writer.page, `${ws}/posts`, 'POST', { body: 'From someone worth following' });
    await api(reader.page, `${ws}/posts`, 'POST', { body: 'From the reader' });

    const { page } = reader;
    await page.goto(`${WEB}${ws}/feed`);
    await page.waitFor(`!!${tab('Following')}`, WAIT_MS);
    await page.eval(`${tab('Following')}.click()`);
    checks.check(
      'an empty Following tab offers teammates to follow',
      await waitUntil(
        page,
        `!!document.querySelector('[role="tabpanel"] button[aria-label^="Follow "]')`,
      ),
    );
    await page.eval(
      `document.querySelector('[role="tabpanel"] button[aria-label^="Follow "]').click()`,
    );
    checks.check(
      'following someone fills the tab with their posts',
      await waitUntil(
        page,
        `document.querySelector('[role="tabpanel"]').textContent.includes('From someone worth following')`,
      ),
    );

    await page.eval(`${tab('Following')}.focus()`);
    await press(page, 'ArrowRight');
    await press(page, 'ArrowRight');
    checks.check(
      'the arrow keys move along the tabs to Highlights, and it holds the check-in',
      await waitUntil(
        page,
        `${tab('Highlights')}.getAttribute('aria-selected') === 'true' && document.activeElement === ${tab('Highlights')} && document.querySelector('[role="tabpanel"]').textContent.includes('What are you working on')`,
      ),
    );

    // A space: follow it from its page, and its new threads come to Following.
    const { space } = await api<{ space: { id: string } }>(writer.page, `${ws}/spaces`, 'POST', {
      name: 'IT help',
    });
    await page.goto(`${WEB}${ws}/spaces/${space.id}`);
    const follow = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Follow')`;
    await page.waitFor(`!!${follow}`, WAIT_MS);
    await page.eval(`${follow}.click()`);
    await page.waitFor(
      `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Following')`,
      WAIT_MS,
    );
    await api(writer.page, `${ws}/spaces/${space.id}/threads`, 'POST', {
      kind: 'question',
      title: 'Why does the VPN drop at noon',
    });
    await page.goto(`${WEB}${ws}/feed`);
    await page.waitFor(`!!${tab('Following')}`, WAIT_MS);
    await page.eval(`${tab('Following')}.click()`);
    checks.check(
      'following a space brings its new threads to the Following tab',
      await waitUntil(
        page,
        `document.querySelector('[role="tabpanel"]').textContent.includes('Why does the VPN drop at noon')`,
      ),
    );
  } finally {
    leave([reader, writer]);
  }
}
