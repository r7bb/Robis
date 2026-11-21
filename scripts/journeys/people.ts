/**
 * The people in the journeys (E1): each a headless Chrome of its own, so
 * sessions never mix, signed up through the real flow with a workspace of
 * its own, and able to call the API as itself from its page.
 */

import type { Page } from '../capture/cdp.ts';
import { pageCall, signUpInBrowser, startChrome, WEB } from '../smoke/browser-session.ts';

export type Person = {
  page: Page;
  stop: () => void;
  /** The workspace each person was given at sign-up. */
  workspaceId: string;
  userId: string;
  username: string;
};

/** The API, as this person, from their page; throws on anything but success. */
export async function api<T = Record<string, unknown>>(
  page: Page,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const result = await pageCall(page, path, method, body);
  if (typeof result === 'string' || result.status >= 300) {
    throw new Error(`${method} ${path}: ${JSON.stringify(result)}`);
  }
  return result.json as T;
}

/** The status the API answers this person with, for the refusals. */
export async function statusOf(
  page: Page,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<number> {
  const result = await pageCall(page, path, method, body);
  return typeof result === 'string' ? 0 : result.status;
}

/** The sign-up limit's window, and a moment more. */
const SIGNUP_WINDOW_MS = 61_000;
const SIGNUP_TRIES = 3;

/**
 * Sign up, waiting out the per-address limit (ten a minute) when the
 * journeys and the smoke tests before them have used it up: the stack keeps
 * production's limits rather than loosening them for the tests.
 */
async function signUpPatiently(page: Page, label: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await signUpInBrowser(page, label);
    } catch (error) {
      const limited = error instanceof Error && error.message.includes('429');
      if (!limited || attempt >= SIGNUP_TRIES) throw error;
      process.stdout.write('  (sign-up limit reached; waiting a minute)\n');
      await Bun.sleep(SIGNUP_WINDOW_MS);
    }
  }
}

/** A fresh account in a Chrome of its own. `port` must differ per person. */
export async function person(port: number, label: string): Promise<Person> {
  const { page, stop } = await startChrome(port, `journey-${label}`);
  try {
    await page.goto(`${WEB}/login`);
    const workspaceId = await signUpPatiently(page, label);
    const { user } = await api<{ user: { id: string; username: string } }>(page, '/auth/me');
    return { page, stop, workspaceId, userId: user.id, username: user.username };
  } catch (error) {
    stop();
    throw error;
  }
}

/** Bring `member` into `owner`'s workspace with `role`, invited by username. */
export async function join(owner: Person, member: Person, role: 'MEMBER' | 'GUEST') {
  const { invitation } = await api<{ invitation: { id: string } }>(
    owner.page,
    `/workspaces/${owner.workspaceId}/members`,
    'POST',
    { username: member.username, role },
  );
  await api(member.page, `/invitations/${invitation.id}/accept`, 'POST', {});
}

/** A project in the person's own workspace; its id. */
export async function project(owner: Person, name: string): Promise<string> {
  const made = await api<{ project: { id: string } }>(
    owner.page,
    `/workspaces/${owner.workspaceId}/projects`,
    'POST',
    { name },
  );
  return made.project.id;
}

/** Everyone's Chrome closed, whatever happened. */
export function leave(people: readonly (Person | undefined)[]) {
  for (const someone of people) {
    if (!someone) continue;
    someone.page.close();
    someone.stop();
  }
}
