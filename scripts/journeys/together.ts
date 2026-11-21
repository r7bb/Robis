/**
 * Two people at once, each in a Chrome of their own: one document edited
 * by both, each seeing the other's words arrive; and a chat message that
 * reaches the other person's open room without a reload.
 */

import { focus, press, typeText, waitUntil } from '../smoke/browser-input.ts';
import { WEB } from '../smoke/browser-session.ts';
import type { Checks } from './checks.ts';
import { api, join, leave, type Person, person } from './people.ts';

const EDITOR = 'textarea[aria-label="Document content"]';
const holds = (text: string) =>
  `document.querySelector('${EDITOR}')?.value.includes(${JSON.stringify(text)})`;

/** Put the cursor at the end of the document and type. */
async function typeAtEnd(someone: Person, text: string) {
  await someone.page.eval(`(() => {
    const el = document.querySelector('${EDITOR}');
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  })()`);
  await typeText(someone.page, text);
}

export async function documentJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('Two people editing one document\n');
  let ada: Person | undefined;
  let ben: Person | undefined;
  try {
    ada = await person(ports[0], 'docada');
    ben = await person(ports[1], 'docben');
    await join(ada, ben, 'MEMBER');
    const { document } = await api<{ document: { id: string } }>(
      ada.page,
      `/workspaces/${ada.workspaceId}/documents`,
      'POST',
      { title: 'Shared notes' },
    );
    const url = `${WEB}/workspaces/${ada.workspaceId}/documents/${document.id}`;
    await ada.page.goto(url);
    await ben.page.goto(url);
    await ada.page.waitFor(`!!document.querySelector('${EDITOR}')`);
    await ben.page.waitFor(`!!document.querySelector('${EDITOR}')`);

    await typeAtEnd(ada, 'Ada was here. ');
    checks.check(
      "Ben's open page shows Ada's words",
      await waitUntil(ben.page, holds('Ada was here.')),
    );
    await typeAtEnd(ben, 'Ben too.');
    checks.check("Ada's open page shows Ben's", await waitUntil(ada.page, holds('Ben too.')));
    checks.check(
      'both keep both',
      (await waitUntil(ada.page, holds('Ada was here.'))) &&
        (await waitUntil(ben.page, holds('Ada was here.'))),
    );
  } finally {
    leave([ada, ben]);
  }
}

export async function chatJourney(checks: Checks, ports: readonly [number, number]) {
  process.stdout.write('Chat delivery\n');
  let ada: Person | undefined;
  let ben: Person | undefined;
  try {
    ada = await person(ports[0], 'chatada');
    ben = await person(ports[1], 'chatben');
    await join(ada, ben, 'MEMBER');
    const home = `${WEB}/workspaces/${ada.workspaceId}`;
    const composer = '[aria-label="Message #general"]';
    await ada.page.goto(home);
    await ben.page.goto(home);
    await ada.page.waitFor(`!!document.querySelector('${composer}')`);
    await ben.page.waitFor(`!!document.querySelector('${composer}')`);

    const words = `Lunch at one? ${Date.now().toString(36)}`;
    await focus(ada.page, composer);
    await typeText(ada.page, words);
    await press(ada.page, 'Enter');
    const said = `document.body.innerText.includes(${JSON.stringify(words)})`;
    checks.check('the message shows for its author', await waitUntil(ada.page, said));
    checks.check('and reaches the other open room, no reload', await waitUntil(ben.page, said));
  } finally {
    leave([ada, ben]);
  }
}
