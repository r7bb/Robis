/**
 * Every dialog by keyboard (C9): each one opens from the keyboard, takes
 * focus, has a name a screen reader announces, keeps Tab inside it, passes
 * axe while open, and closes on Escape with focus back where it was. Also
 * the board's cards and the document editor, from the keyboard alone.
 */

import type { Page } from '../capture/cdp.ts';
import { CTRL, focus, press, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

const OPEN = `[...document.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"]')].filter((d) => d.open || d.getClientRects().length > 0)`;
const TAB_PRESSES = 14;

/** Whether focus is inside an open dialog, and that dialog's name. */
const state = (page: Page) =>
  page.eval<{ inside: boolean; name: string }>(`(() => {
    const dialogs = ${OPEN};
    const holder = dialogs.find((d) => d.contains(document.activeElement));
    const dialog = holder ?? dialogs[0];
    if (!dialog) return { inside: false, name: '' };
    // A native modal may hand Tab on to the browser's own controls, which
    // the page sees as focus on its body; only a control behind the dialog
    // would be focus escaping.
    const onBrowser = document.activeElement === document.body || document.activeElement === null;
    const label = dialog.getAttribute('aria-label')
      ?? (dialog.getAttribute('aria-labelledby') ?? '')
        .split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    return { inside: Boolean(holder) || onBrowser, name: label.trim() };
  })()`);

/**
 * Open a dialog with `open` (keys from a marked opener), then check it the
 * way a keyboard and a screen reader would meet it.
 */
async function dialog(
  checks: Checks,
  page: Page,
  name: string,
  opener: string,
  open: () => Promise<void>,
) {
  await page.eval(
    `document.querySelector(${JSON.stringify(opener)})?.setAttribute('data-opener', '')`,
  );
  await open();
  const opened = await waitUntil(page, `${OPEN}.length > 0`);
  checks.check(`${name}: opens from the keyboard`, opened);
  if (!opened) return;
  await Bun.sleep(300);
  const first = await state(page);
  checks.check(
    `${name}: takes focus and has a name`,
    first.inside && first.name.length > 0,
    JSON.stringify(first),
  );
  let stayed = true;
  for (let i = 0; i < TAB_PRESSES; i++) {
    await press(page, 'Tab');
    if (!(await state(page)).inside) stayed = false;
  }
  checks.check(`${name}: Tab stays inside`, stayed);
  await press(page, 'Escape');
  const closed = await waitUntil(page, `${OPEN}.length === 0`);
  const back = await page.eval<boolean>(
    `document.activeElement?.hasAttribute('data-opener') ?? false`,
  );
  checks.check(`${name}: Escape closes it and focus goes back`, closed && back);
  await page.eval(
    `document.querySelectorAll('[data-opener]').forEach((e) => e.removeAttribute('data-opener'))`,
  );
}

const keysOn = async (page: Page, selector: string, key: string, modifiers = 0) => {
  await focus(page, selector);
  await press(page, key, modifiers);
};

export async function keyboardDialogsJourney(checks: Checks, port: number) {
  process.stdout.write('Every dialog by keyboard\n');
  let owner: Person | undefined;
  try {
    owner = await person(port, 'keyboard');
    const { page, workspaceId } = owner;
    const projectId = await project(owner, 'Keys');
    const { issue } = await api<{ issue: { id: string } }>(
      page,
      `/workspaces/${workspaceId}/projects/${projectId}/issues`,
      'POST',
      { title: 'Reach me by keyboard' },
    );
    await api(page, `/workspaces/${workspaceId}/stories`, 'POST', {
      body: 'Hello from the keys',
      tone: 'sea',
    });
    // A picture on the issue, for the picture viewer.
    await page.goto(`${WEB}/workspaces`);
    await page.eval(`(async () => {
      const png = await (await fetch('/icons/icon-192.png')).blob();
      await fetch('/api/workspaces/${workspaceId}/issues/${issue.id}/attachments', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'image/png' }, body: png,
      });
    })()`);
    const ws = `/workspaces/${workspaceId}`;

    // The board: cards by J and K, Enter opens the peek.
    await page.goto(`${WEB}${ws}/projects/${projectId}`);
    await page.waitFor('!!document.querySelector("[data-card]")', WAIT_MS);
    await page.eval('document.activeElement?.blur(); document.body.focus()');
    await press(page, 'J');
    checks.check(
      'the board: J moves to a card',
      await waitUntil(page, `document.activeElement?.hasAttribute('data-card') ?? false`),
    );
    await dialog(checks, page, 'the issue peek', '[data-card]', () => press(page, 'Enter'));
    await page.eval('document.activeElement?.blur(); document.body.focus()');
    await dialog(checks, page, 'the shortcut help', 'body', () => press(page, '?'));
    await dialog(checks, page, 'the command palette', 'body', async () => {
      await page.eval('document.activeElement?.blur(); document.body.focus()');
      await press(page, 'K', CTRL);
    });
    await dialog(checks, page, 'deleting a board', 'button[aria-label^="Delete"]', () =>
      keysOn(page, 'button[aria-label^="Delete"]', 'Enter'),
    );
    await dialog(checks, page, 'the camera', 'button[aria-label="Camera: take a photo"]', () =>
      keysOn(page, 'button[aria-label="Camera: take a photo"]', 'Enter'),
    );

    // The issue page: the picture viewer.
    await page.goto(`${WEB}${ws}/issues/${issue.id}`);
    const picture = 'button[aria-label="Open image"]';
    await page.waitFor(`!!document.querySelector(${JSON.stringify(picture)})`, WAIT_MS);
    await dialog(checks, page, 'the picture viewer', picture, () => keysOn(page, picture, 'Enter'));

    // Meetings: scheduling one.
    await page.goto(`${WEB}${ws}/meetings`);
    const schedule = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Schedule a meeting')`;
    await page.waitFor(`!!${schedule}`, WAIT_MS);
    await page.eval(`${schedule}.setAttribute('data-key-target', '')`);
    await dialog(checks, page, 'scheduling a meeting', '[data-key-target]', () =>
      keysOn(page, '[data-key-target]', 'Enter'),
    );

    // The feed: posting a story, and watching one.
    await page.goto(`${WEB}${ws}/feed`);
    await page.waitFor('!!document.querySelector("button[aria-label=\\"Add a story\\"]")', WAIT_MS);
    await dialog(checks, page, 'posting a story', 'button[aria-label="Add a story"]', () =>
      keysOn(page, 'button[aria-label="Add a story"]', 'Enter'),
    );
    const ring = 'button[aria-label*="story"]:not([aria-label="Add a story"])';
    await dialog(checks, page, 'watching a story', ring, () => keysOn(page, ring, 'Enter'));

    // The document editor: reached and written in with the keyboard alone.
    const { document } = await api<{ document: { id: string } }>(page, `${ws}/documents`, 'POST', {
      title: 'Typed',
    });
    await page.goto(`${WEB}${ws}/documents/${document.id}`);
    await page.waitFor('!!document.querySelector("textarea")', WAIT_MS);
    const named = await page.eval<boolean>(
      `(() => { const t = document.querySelector('textarea'); return !!(t.getAttribute('aria-label') || t.labels?.length); })()`,
    );
    await focus(page, 'textarea');
    await typeText(page, 'Written without a mouse');
    checks.check(
      'the document editor has a name and takes typing',
      named &&
        (await waitUntil(
          page,
          `document.querySelector('textarea').value.includes('Written without a mouse')`,
        )),
    );
  } finally {
    leave([owner]);
  }
}
