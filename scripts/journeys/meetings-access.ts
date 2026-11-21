/**
 * A meeting rescheduled clears the answers already given, and the invitee
 * sees that; a guest sees no control that would change the work; and
 * someone outside the workspace gets not found, from the page and the API.
 */

import { waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, join, leave, type Person, person, project, statusOf } from './people.ts';

const HOUR_MS = 60 * 60 * 1000;

/** The meeting card's Yes button, found by the meeting's title. */
const yesButton = (title: string) => `[...document.querySelectorAll('article')]
  .find((card) => card.textContent.includes(${JSON.stringify(title)}))
  ?.querySelector('fieldset button')`;

export async function meetingJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('A meeting rescheduled clears its answers\n');
  let ada: Person | undefined;
  let ben: Person | undefined;
  try {
    ada = await person(ports[0], 'meetada');
    ben = await person(ports[1], 'meetben');
    await join(ada, ben, 'MEMBER');
    const title = `Planning ${Date.now().toString(36)}`;
    const startsAt = new Date(Date.now() + 24 * HOUR_MS);
    const { meeting } = await api<{ meeting: { id: string } }>(
      ada.page,
      `/workspaces/${ada.workspaceId}/meetings`,
      'POST',
      { title, startsAt: startsAt.toISOString(), attendeeIds: [ben.userId] },
    );

    const page = ben.page;
    await page.goto(`${WEB}/workspaces/${ada.workspaceId}/meetings`);
    if (
      !checks.check(
        'the invitee sees the meeting',
        await waitUntil(page, `!!(${yesButton(title)})`),
      )
    ) {
      return;
    }
    await page.eval(`${yesButton(title)}.click()`);
    const answered = `${yesButton(title)}?.getAttribute('aria-pressed') === 'true'`;
    checks.check('the invitee answers yes', await waitUntil(page, answered));

    await api(ada.page, `/workspaces/${ada.workspaceId}/meetings/${meeting.id}`, 'PATCH', {
      startsAt: new Date(startsAt.getTime() + HOUR_MS).toISOString(),
    });
    const cleared = `${yesButton(title)}?.getAttribute('aria-pressed') === 'false'`;
    checks.check(
      'the open page shows the answer cleared, no reload',
      await waitUntil(page, cleared),
    );
    await page.goto(`${WEB}/workspaces/${ada.workspaceId}/meetings`);
    checks.check('and after a reload, still cleared', await waitUntil(page, cleared));
  } finally {
    leave([ada, ben]);
  }
}

export async function guestJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('A guest sees no write controls\n');
  let ada: Person | undefined;
  let guest: Person | undefined;
  try {
    ada = await person(ports[0], 'guestada');
    guest = await person(ports[1], 'guestgil');
    await join(ada, guest, 'GUEST');
    const projectId = await project(ada, 'Client work');
    const { issue } = await api<{ issue: { id: string } }>(
      ada.page,
      `/workspaces/${ada.workspaceId}/projects/${projectId}/issues`,
      'POST',
      { title: 'Shared with a guest' },
    );

    const page = guest.page;
    await page.goto(`${WEB}/workspaces/${ada.workspaceId}/projects/${projectId}`);
    checks.check(
      'the guest sees the board and its card',
      await waitUntil(page, `!!document.querySelector('[data-card]')`),
    );
    checks.check(
      'with no field to file an issue',
      !(await page.eval<boolean>(
        `!!document.querySelector('input[aria-label="New issue title"]')`,
      )),
    );
    checks.check(
      'no card to drag or select',
      !(await page.eval<boolean>(
        `!!document.querySelector('[data-card][draggable=true], [data-card] input[type=checkbox]')`,
      )),
    );

    await page.goto(`${WEB}/workspaces/${ada.workspaceId}/issues/${issue.id}`);
    checks.check(
      'the guest can open the issue',
      await waitUntil(page, `document.body.innerText.includes('Shared with a guest')`),
    );
    const editable = await page.eval<string[]>(`[...document.querySelectorAll('main select')]
      .filter((el) => !el.disabled).map((el) => el.getAttribute('aria-label') ?? el.name)`);
    checks.check('every field on it is read-only', editable.length === 0, editable.join(', '));
    checks.check(
      'and there is no delete',
      !(await page.eval<boolean>(
        `[...document.querySelectorAll('button')].some((b) => /^delete/i.test(b.textContent.trim()))`,
      )),
    );
    checks.check(
      'the API refuses the guest a change',
      (await statusOf(page, `/workspaces/${ada.workspaceId}/issues/${issue.id}`, 'PATCH', {
        title: 'Renamed by a guest',
      })) === 403,
    );
  } finally {
    leave([ada, guest]);
  }
}

export async function strangerJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('Someone outside the workspace gets not found\n');
  let ada: Person | undefined;
  let stranger: Person | undefined;
  try {
    ada = await person(ports[0], 'outada');
    stranger = await person(ports[1], 'outsam');
    const projectId = await project(ada, 'Private');
    const page = stranger.page;
    await page.goto(`${WEB}/workspaces/${ada.workspaceId}/projects/${projectId}`);
    checks.check(
      'the page says not found and offers the way back',
      await waitUntil(
        page,
        `/not found/i.test(document.body.innerText) && document.body.innerText.includes('Back to workspaces')`,
      ),
    );
    checks.check(
      'nothing of the board shows',
      !(await page.eval<boolean>(
        `!!document.querySelector('[data-card], input[aria-label="New issue title"]')`,
      )),
    );
    checks.check(
      'the API answers 404, not 403',
      (await statusOf(page, `/workspaces/${ada.workspaceId}/projects/${projectId}/issues`)) === 404,
    );
  } finally {
    leave([ada, stranger]);
  }
}
