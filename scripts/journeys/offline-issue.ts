/**
 * An issue offline, on a phone (C8). Done when: with the network off, a
 * phone-sized browser opens an issue it has seen before (the page from the
 * service worker, the issue and its comments from IndexedDB), queues a
 * comment that shows as not sent yet, and on reconnect the comment lands
 * on the server exactly once.
 */

import { focus, press, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const TITLE = 'Read on the train';
const COMMENT = 'Written with no signal';
const PENDING = `!!document.querySelector('[data-pending-comment]')`;

export async function offlineIssueJourney(checks: Checks, port: number) {
  process.stdout.write('An issue offline, on a phone\n');
  let someone: Person | undefined;
  try {
    someone = await person(port, 'offissue');
    const { page, workspaceId } = someone;
    const projectId = await project(someone, 'Commute');
    const { issue } = await api<{ issue: { id: string } }>(
      page,
      `/workspaces/${workspaceId}/projects/${projectId}/issues`,
      'POST',
      { title: TITLE },
    );
    await page.send('Emulation.setDeviceMetricsOverride', PHONE);
    const url = `${WEB}/workspaces/${workspaceId}/issues/${issue.id}`;

    // Seen once online: the page is cached and the issue kept on the device.
    await page.goto(url);
    await page.waitFor(`!!document.querySelector('[data-empty="comments"]')`, WAIT_MS);
    checks.check(
      'the service worker looks after the page',
      await waitUntil(page, '!!navigator.serviceWorker?.controller'),
    );
    await Bun.sleep(500);

    await page.setOffline(true);
    checks.check('the network is off', await waitUntil(page, '!navigator.onLine'));
    await page.goto(url);
    checks.check(
      'the issue opens from the device with the network off',
      await waitUntil(page, `document.body.textContent.includes(${JSON.stringify(TITLE)})`),
    );

    await focus(page, 'textarea[aria-label="New comment"]');
    await typeText(page, COMMENT);
    await page.eval(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Comment').click()`,
    );
    checks.check('the comment waits, marked not sent yet', await waitUntil(page, PENDING));

    await page.setOffline(false);
    checks.check('on reconnect it is sent', await waitUntil(page, `!(${PENDING})`, WAIT_MS * 2));
    const { comments } = await api<{ comments: { body: string }[] }>(
      page,
      `/workspaces/${workspaceId}/issues/${issue.id}/comments`,
    );
    checks.check(
      'and lands on the server exactly once',
      comments.filter((c) => c.body === COMMENT).length === 1,
      `${comments.length} comments`,
    );
    await press(page, 'Escape');
  } finally {
    leave([someone]);
  }
}
