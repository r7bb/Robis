/**
 * Sharing to Robis from another app (C8): the phone posts what was shared
 * to the manifest's share target, as a multipart form. Here the page posts
 * that same form itself, through the service worker that catches it; the
 * share page then makes an issue of it, with the picture attached and the
 * link as its first comment.
 */

import { WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

const TITLE = 'Broken sign by the lift';
const LINK = 'https://example.com/the-sign';
/** Half-second looks for the upload to land: a minute in all. */
const SETTLE_TRIES = 120;

export async function shareJourney(checks: Checks, port: number) {
  process.stdout.write('Sharing to Robis\n');
  let someone: Person | undefined;
  try {
    someone = await person(port, 'sharer');
    const { page, workspaceId } = someone;
    const projectId = await project(someone, 'Building');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await page.goto(`${WEB}/workspaces`);
    await page.waitFor('!!navigator.serviceWorker?.controller', WAIT_MS);

    // What a phone's share sheet sends: a title, a link and a photo.
    const landed = await page.eval<string>(`(async () => {
      const photo = await (await fetch('/icons/icon-192.png')).blob();
      const form = new FormData();
      form.append('title', ${JSON.stringify(TITLE)});
      form.append('url', ${JSON.stringify(LINK)});
      form.append('files', new File([photo], 'sign.png', { type: 'image/png' }));
      const answer = await fetch('/share', { method: 'POST', body: form });
      return new URL(answer.url).pathname;
    })()`);
    checks.check('the service worker takes the share and sends it on', landed === '/share', landed);

    await page.goto(`${WEB}/share`);
    checks.check(
      'the share page shows the picture and the link',
      await waitUntil(
        page,
        `!!document.querySelector('img[alt^="Shared"]') && document.body.textContent.includes(${JSON.stringify(LINK)})`,
      ),
    );
    await page.waitFor(`!!document.querySelector('select option')`, WAIT_MS);
    await page.eval(
      `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Make the issue').click()`,
    );
    checks.check(
      'making the issue opens its board',
      await waitUntil(
        page,
        `location.pathname.endsWith(${JSON.stringify(`/projects/${projectId}`)})`,
      ),
    );

    const settled = async () => {
      const { issues } = await api<{ issues: { id: string; title: string }[] }>(
        page,
        `/workspaces/${workspaceId}/projects/${projectId}/issues`,
      );
      const issue = issues.find((i) => i.title === TITLE);
      if (!issue) return null;
      const [{ attachments }, { comments }] = await Promise.all([
        api<{ attachments: unknown[] }>(
          page,
          `/workspaces/${workspaceId}/issues/${issue.id}/attachments`,
        ),
        api<{ comments: { body: string }[] }>(
          page,
          `/workspaces/${workspaceId}/issues/${issue.id}/comments`,
        ),
      ]);
      return { attachments: attachments.length, link: comments.some((c) => c.body.includes(LINK)) };
    };
    let result = await settled();
    // The photo is queued, uploaded and resized after the board opens; a busy
    // CI runner has taken longer than 15 s, so this allows a minute.
    for (let i = 0; i < SETTLE_TRIES && !(result && result.attachments === 1 && result.link); i++) {
      await Bun.sleep(500);
      result = await settled();
    }
    checks.check(
      'the server has the issue, its picture and the link',
      result?.attachments === 1 && result.link === true,
      JSON.stringify(result),
    );
    checks.check(
      'and the share is gone from the device',
      await page.eval<boolean>(`caches.has('robis-share').then((has) => !has)`),
    );
  } finally {
    leave([someone]);
  }
}
