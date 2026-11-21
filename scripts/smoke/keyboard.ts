/**
 * Keyboard-only browser test against a running stack: `bun run smoke:keyboard`.
 *
 * C2's done-when: every board action, completed without a mouse. A fresh
 * account files issues, moves between cards, changes a status, moves a card
 * to another column and back, selects two and changes both, filters,
 * saves a view, picks it, deletes it, clears the filter from the command
 * palette, deletes an issue, opens one and comes back, and opens the help.
 *
 * Every input is a key event or typed text sent to the page (CDP
 * Input.dispatchKeyEvent and Input.insertText). Nothing here clicks, moves
 * a pointer or moves focus by script; scripts only read the page to check
 * it. (The account and its project are set up through the API first.)
 */

import type { Page } from '../capture/cdp.ts';
import { CTRL, press, SHIFT, typeText, WAIT_MS, waitUntil } from './browser-input.ts';
import { pageCall, signUpInBrowser, startChrome, WEB } from './browser-session.ts';

const PORT = Number(process.env.SMOKE_KEYBOARD_CDP_PORT ?? 9488);

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  process.stdout.write(`  ${ok ? 'ok ' : 'NOT'} ${name}${ok || !detail ? '' : `: ${detail}`}\n`);
}

/** Type into a focused select: its options are picked by their first letters. */
async function typeAhead(page: Page, text: string) {
  for (const char of text) await press(page, char);
  await Bun.sleep(300);
}

const active = (page: Page, expression: string) =>
  page.eval<string | null>(
    `(() => { const el = document.activeElement; return el ? (${expression}) : null; })()`,
  );
const activeLabel = (page: Page) => active(page, 'el.getAttribute("aria-label")');
const focusedCard = (page: Page) =>
  active(page, 'el.closest("[data-card]")?.getAttribute("data-card") ?? null');

type Card = { id: string; title: string; status: string; checked: boolean; synced: boolean };
const cards = (page: Page) =>
  page.eval<Card[]>(`[...document.querySelectorAll('[data-card]')].map((li) => ({
    id: li.getAttribute('data-card'),
    title: li.getAttribute('aria-label'),
    status: li.getAttribute('data-status') ?? '',
    checked: !!li.querySelector('input[type=checkbox]')?.checked,
    synced: !li.textContent.includes('Unsynced'),
  }))`);
/** A card by id, quoted for the page: ids are the page's own, but never trusted as code. */
const cardSelector = (id: string | null) => JSON.stringify(`[data-card=${JSON.stringify(id)}]`);

const statusOf = async (page: Page, id: string) =>
  (await cards(page)).find((c) => c.id === id)?.status;

/** Press Tab (or Shift Tab) until focus is on the element `label` names. */
async function tabTo(page: Page, label: string, backwards = false, most = 40) {
  for (let i = 0; i < most; i++) {
    if ((await activeLabel(page)) === label) return true;
    await press(page, 'Tab', backwards ? SHIFT : 0);
  }
  return (await activeLabel(page)) === label;
}

const TYPING = `['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.type !== 'checkbox'`;

/** Tab on until focus is somewhere a key is a shortcut, not text. */
async function leaveField(page: Page, most = 20) {
  for (let i = 0; i < most && (await active(page, TYPING)); i++) await press(page, 'Tab');
}

/** Wait until the palette's chosen row is the one wanted, then take it. */
async function choose(page: Page, title: string) {
  const ready = await waitUntil(
    page,
    `document.querySelector('dialog[open] [role=option][aria-selected=true]')?.textContent.startsWith(${JSON.stringify(title)})`,
  );
  check(`the palette offers ${title}`, ready);
  await press(page, 'Enter');
}

async function fileIssues(page: Page, titles: readonly string[]) {
  await press(page, 'c');
  check('C goes to the new issue field', (await activeLabel(page)) === 'New issue title');
  for (const title of titles) {
    await typeText(page, title);
    await press(page, 'Enter');
  }
  await press(page, 'Escape');
  check('Escape leaves the field', (await activeLabel(page)) !== 'New issue title');
  const synced = await waitUntil(
    page,
    `document.querySelectorAll('[data-card]').length === ${titles.length} && !document.body.textContent.includes('Unsynced')`,
  );
  check(`${titles.length} issues filed and synced`, synced, JSON.stringify(await cards(page)));
}

async function moveAround(page: Page) {
  await press(page, 'j');
  const first = await focusedCard(page);
  check('J focuses a card', !!first);
  await press(page, 'j');
  const second = await focusedCard(page);
  check('J again, the next one down', !!second && second !== first);
  await press(page, 'k');
  check('K, back up', (await focusedCard(page)) === first);
  return first!;
}

async function changeStatus(page: Page, id: string) {
  await press(page, '2');
  check(
    '2 moves it to In Progress',
    await waitUntil(
      page,
      `document.querySelector(${cardSelector(id)})?.getAttribute('data-status') === 'IN_PROGRESS'`,
    ),
  );
  check('and focus follows it', (await focusedCard(page)) === id, String(await focusedCard(page)));
  await press(page, 'h');
  const left = await focusedCard(page);
  check('H, a card in the column to the left', !!left && left !== id);
  // Back to the card, then move it by hand: lift, left, drop.
  await press(page, 'l');
  if ((await focusedCard(page)) !== id) await press(page, 'l');
  check(
    'L reaches it in its column',
    (await focusedCard(page)) === id,
    String(await focusedCard(page)),
  );
  await press(page, 'm');
  check(
    'M picks it up',
    (await active(page, 'el.getAttribute("aria-pressed")')) === 'true' &&
      (await focusedCard(page)) === id,
  );
  await press(page, 'ArrowLeft');
  await press(page, ' ');
  check(
    'arrow and Space put it back in Todo',
    await waitUntil(
      page,
      `document.querySelector(${cardSelector(id)})?.getAttribute('data-status') === 'TODO'`,
    ),
    String(await statusOf(page, id)),
  );
  check('focus stays on it', (await focusedCard(page)) === id, String(await focusedCard(page)));
}

async function bulkChange(page: Page) {
  await press(page, 'x');
  const first = await focusedCard(page);
  await press(page, 'j');
  await press(page, 'x');
  const picked = (await cards(page)).filter((c) => c.checked).map((c) => c.id);
  check('X selects the card, and the next', picked.length === 2, JSON.stringify(picked));
  check('the first was the one focused', !!first && picked.includes(first));
  check('a bar for the selection', await tabTo(page, 'Move selected to', true));
  await typeAhead(page, 'do');
  const done = await waitUntil(
    page,
    `[...document.querySelectorAll('[data-card]')].filter((li) => li.getAttribute('data-status') === 'DONE').length === 2`,
  );
  check('both moved to Done in one change', done, JSON.stringify(await cards(page)));
  await press(page, 'Escape');
  check(
    'Escape stops selecting',
    (await cards(page)).every((c) => !c.checked) &&
      (await page.eval<number>(
        'document.querySelectorAll("[data-card] input[type=checkbox]").length',
      )) === 0,
  );
}

async function filterAndViews(page: Page) {
  await press(page, 'f');
  check('F goes to the filters', (await activeLabel(page)) === 'Status');
  await typeAhead(page, 'do');
  check(
    'a filter by status, in the address',
    await waitUntil(
      page,
      `location.search.includes('status=DONE') && document.querySelectorAll('[data-card]').length === 2`,
    ),
  );
  // Off the select, so the next key is a shortcut again.
  await leaveField(page);
  await press(page, 'v');
  check('V goes to saved views', (await active(page, 'el.textContent')) === 'Save view…');
  await press(page, 'Enter');
  check('Enter opens the name field', (await activeLabel(page)) === 'View name');
  await typeText(page, 'Done work');
  await press(page, 'Enter');
  check(
    'the view is saved',
    await waitUntil(
      page,
      `[...document.querySelectorAll('select[aria-label="Saved view"] option')].some((o) => o.textContent === 'Done work')`,
    ),
  );

  // Clear the filter from the palette, opened with the slash key.
  await leaveField(page);
  await press(page, '/');
  check(
    '/ opens the command palette',
    await page.eval<boolean>('!!document.querySelector("dialog[open]")'),
  );
  await typeText(page, 'clear filters');
  await choose(page, 'Clear filters');
  check(
    'Clear filters, from the palette',
    await waitUntil(
      page,
      `!location.search.includes('status=') && document.querySelectorAll('[data-card]').length === 3`,
    ),
  );

  await press(page, 'v');
  check('V now goes to the view list', (await activeLabel(page)) === 'Saved view');
  await typeAhead(page, 'do');
  check(
    'picking the view filters the board',
    await waitUntil(page, `location.search.includes('status=DONE')`),
  );
  check('Tab to the delete of the view in use', await tabTo(page, 'Delete saved view Done work'));
  await press(page, 'Enter');
  await confirmDelete(page);
  check(
    'the view is gone',
    await waitUntil(
      page,
      `![...document.querySelectorAll('select[aria-label="Saved view"] option')].some((o) => o.textContent === 'Done work')`,
    ),
  );
}

/** In a delete confirmation: Cancel has focus, so Tab to Delete, then Enter. */
async function confirmDelete(page: Page) {
  check(
    'a confirmation, with Cancel focused',
    (await waitUntil(page, 'document.querySelector("[role=alertdialog]")', 3_000)) &&
      (await active(page, 'el.textContent')) === 'Cancel',
  );
  await press(page, 'Tab');
  check('Tab to Delete', (await active(page, 'el.textContent')) === 'Delete');
  await press(page, 'Enter');
}

async function deleteAndOpen(page: Page, boardName: string) {
  await leaveField(page);
  await press(page, '/');
  await typeText(page, 'clear filters');
  await choose(page, 'Clear filters');
  await waitUntil(page, `document.querySelectorAll('[data-card]').length === 3`);

  await press(page, 'j');
  const doomed = await focusedCard(page);
  await press(page, 'Delete');
  await confirmDelete(page);
  check(
    'Delete removes the card',
    await waitUntil(
      page,
      `!document.querySelector(${cardSelector(doomed)}) && document.querySelectorAll('[data-card]').length === 2`,
    ),
  );

  await press(page, 'j');
  const card = await page.eval<string>('document.activeElement?.getAttribute("data-card") ?? ""');
  await press(page, 'Enter');
  check(
    'Enter on a card opens it over the board',
    await waitUntil(
      page,
      `location.search.includes("issue=") && !!document.querySelector('[role=dialog][aria-label=Issue] h1')`,
    ),
  );
  await press(page, 'Escape');
  check(
    'Escape closes it, back on the card',
    await waitUntil(
      page,
      `!document.querySelector('[role=dialog][aria-label=Issue]') && document.activeElement?.getAttribute('data-card') === ${JSON.stringify(card)}`,
    ),
  );
  // From the issue's own page, the palette finds the way back to the board.
  const board = await page.eval<string>('location.pathname');
  await page.goto(`${WEB}${board.replace(/\/projects\/.*$/, '')}/issues/${card}`);
  await waitUntil(page, 'document.querySelector("h1")');
  await press(page, 'k', CTRL);
  await typeText(page, boardName);
  await choose(page, boardName);
  check(
    'and Ctrl K back to the board',
    await waitUntil(
      page,
      `location.pathname.includes("/projects/") && document.querySelectorAll('[data-card]').length === 2`,
    ),
  );
}

async function help(page: Page) {
  await leaveField(page);
  await press(page, '?', SHIFT);
  check(
    '? opens the shortcuts',
    await page.eval<boolean>(
      `document.querySelector('dialog[open]')?.textContent.includes('Keyboard shortcuts') ?? false`,
    ),
  );
  await press(page, 'Escape');
  check('Escape closes them', await page.eval<boolean>('!document.querySelector("dialog[open]")'));
}

async function main() {
  process.stdout.write(`Keyboard-only board test against ${WEB}\n`);
  const { page, stop } = await startChrome(PORT, 'keyboard-smoke');
  try {
    await page.goto(`${WEB}/login`);
    const workspaceId = await signUpInBrowser(page, 'keyboard');
    const made = await pageCall(page, `/workspaces/${workspaceId}/projects`, 'POST', {
      name: 'Keys',
    });
    const projectId =
      typeof made === 'string'
        ? undefined
        : (made.json as { project?: { id: string } }).project?.id;
    if (!projectId) throw new Error(`project: ${JSON.stringify(made)}`);

    await page.goto(`${WEB}/workspaces/${workspaceId}/projects/${projectId}`);
    await page.waitFor('document.querySelector(\'input[aria-label="New issue title"]\')', WAIT_MS);
    await fileIssues(page, ['First by keyboard', 'Second by keyboard', 'Third by keyboard']);
    const first = await moveAround(page);
    await changeStatus(page, first);
    await bulkChange(page);
    await filterAndViews(page);
    await deleteAndOpen(page, 'Keys board');
    await help(page);
    page.close();
  } finally {
    stop();
  }

  if (failures > 0) {
    process.stderr.write(`Keyboard-only board test failed: ${failures} check(s).\n`);
    process.exit(1);
  }
  process.stdout.write('Keyboard-only board test passed.\n');
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Keyboard-only board test failed. ${error instanceof Error ? error.message : error}\n`,
  );
  process.exit(1);
}
