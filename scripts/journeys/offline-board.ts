/**
 * An issue filed on the board with the network cut, then the network back:
 * it shows at once, marked unsynced; on reconnect it reaches the server
 * once, the mark goes, and after a reload it is there and synced. A broken
 * offline queue fails here: tried on 2026-11-21 with its flush made to send
 * nothing, the card stayed unsynced and the server never got it, and the
 * journey failed on both.
 */

import { focus, press, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

const TITLE_INPUT = 'input[aria-label="New issue title"]';
const UNSYNCED = `document.body.textContent.includes('Unsynced')`;

const hasCard = (title: string) =>
  `[...document.querySelectorAll('[data-card]')].some((card) => card.getAttribute('aria-label')?.includes(${JSON.stringify(title)}))`;

export async function offlineBoardJourney(checks: Checks, port: number) {
  process.stdout.write('Offline board: create, then reconnect\n');
  let owner: Person | undefined;
  try {
    owner = await person(port, 'offline');
    const projectId = await project(owner, 'Offline');
    const { page } = owner;
    const board = `${WEB}/workspaces/${owner.workspaceId}/projects/${projectId}`;
    await page.goto(board);
    await page.waitFor(`!!document.querySelector('${TITLE_INPUT}')`, WAIT_MS);

    await page.setOffline(true);
    checks.check('the browser is offline', await waitUntil(page, '!navigator.onLine'));
    const title = `Filed offline ${Date.now().toString(36)}`;
    await focus(page, TITLE_INPUT);
    await typeText(page, title);
    await press(page, 'Enter');
    checks.check('the card shows at once, offline', await waitUntil(page, hasCard(title)));
    checks.check('and is marked unsynced', await waitUntil(page, UNSYNCED));

    await page.setOffline(false);
    checks.check('on reconnect the unsynced mark goes', await waitUntil(page, `!(${UNSYNCED})`));
    const { issues } = await api<{ issues: { title: string }[] }>(
      page,
      `/workspaces/${owner.workspaceId}/projects/${projectId}/issues`,
    );
    const copies = issues.filter((issue) => issue.title === title).length;
    checks.check('the server has it, exactly once', copies === 1, `${copies} copies`);

    await page.goto(board);
    // The browser keeps its own copy, so a card alone proves little: it must
    // be there and synced, as the server sent it back.
    checks.check(
      'after a reload it is still there, synced',
      await waitUntil(page, `${hasCard(title)} && !(${UNSYNCED})`),
    );
  } finally {
    leave([owner]);
  }
}
