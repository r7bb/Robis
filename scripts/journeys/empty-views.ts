/**
 * Empty views (C5), in Chrome: a new board says what goes on it and its one
 * button moves to the field that fills it; once an issue is filed the empty
 * view is gone; an issue with no comments does the same for its comment box;
 * and the empty docs list points at the sample-document guide. Then the
 * demo workspace: one click from the first run opens a board of example
 * issues, labelled as a demo, with its document and channel beside it.
 */

import { DEMO_WORKSPACE } from '@robis/shared';
import { press, typeText, WAIT_MS, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, leave, type Person, person, project } from './people.ts';

/** Presses the empty view's button and reports the accessible name of what has focus. */
const pressAndFocused = (view: string) => `(() => {
  const button = document.querySelector('[data-empty="${view}"] button');
  if (!button) return 'no button';
  button.click();
  return document.activeElement?.getAttribute('aria-label') ?? 'nothing';
})()`;

export async function emptyViewsJourney(checks: Checks, port: number) {
  process.stdout.write('Empty views\n');
  let owner: Person | undefined;
  try {
    owner = await person(port, 'empty');
    const projectId = await project(owner, 'Blank');
    const { page, workspaceId } = owner;

    await page.goto(`${WEB}/workspaces/${workspaceId}/projects/${projectId}`);
    checks.check(
      'a new board says what goes on it',
      await waitUntil(page, `!!document.querySelector('[data-empty="issues"]')`),
    );
    checks.check(
      'with a guide one link away',
      await page.eval<boolean>(
        `!!document.querySelector('[data-empty="issues"] a[href^="/guide/create_issue?w="]')`,
      ),
    );
    const focused = await page.eval<string>(pressAndFocused('issues'));
    checks.check('its button moves to the new issue field', focused === 'New issue title', focused);
    await typeText(page, 'The first thing to do');
    await press(page, 'Enter');
    checks.check(
      'and once an issue is filed the empty view is gone',
      await waitUntil(page, `!document.querySelector('[data-empty="issues"]')`),
    );
    checks.check(
      'the empty docs list offers the sample document',
      await page.eval<boolean>(
        `!!document.querySelector('[data-empty="docs"] a[href^="/guide/try_document?w="]')`,
      ),
    );

    const { issues } = await api<{ issues: { id: string }[] }>(
      page,
      `/workspaces/${workspaceId}/projects/${projectId}/issues`,
    );
    await page.goto(`${WEB}/workspaces/${workspaceId}/issues/${issues[0]!.id}`);
    await page.waitFor(`!!document.querySelector('[data-empty="comments"]')`, WAIT_MS);
    const commentFocus = await page.eval<string>(pressAndFocused('comments'));
    checks.check(
      'an issue with no comments moves to the comment box',
      commentFocus === 'New comment',
      commentFocus,
    );
  } finally {
    leave([owner]);
  }
}

export async function demoWorkspaceJourney(checks: Checks, port: number) {
  process.stdout.write('Demo workspace\n');
  let someone: Person | undefined;
  try {
    someone = await person(port, 'demo');
    const { page } = someone;
    await page.goto(`${WEB}/first-run`);
    const button = `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Look around a demo workspace'))`;
    await page.waitFor(`!!${button}`, WAIT_MS);
    await page.eval(`${button}.click()`);
    checks.check(
      'one click from the first run opens a board of example issues',
      await waitUntil(
        page,
        `document.querySelectorAll('[data-card]').length === ${DEMO_WORKSPACE.issues.length}`,
      ),
    );
    checks.check(
      'labelled as a demo',
      await page.eval<boolean>(
        `[...document.querySelectorAll('header span, nav span')].some((s) => s.textContent.trim().toLowerCase() === 'demo')`,
      ),
    );
    checks.check(
      'with its document in the left rail',
      await waitUntil(page, `document.body.textContent.includes('Relaunch plan')`),
    );
  } finally {
    leave([someone]);
  }
}
