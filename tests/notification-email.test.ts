import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  DIGEST_HOUR_UTC,
  emailDigests,
  MENTION_EMAILS_PER_HOUR,
  notifications,
  scanDigests,
  users,
  workspaces,
} from '@robis/database';
import type { Mail, Mailer } from '@robis/mailer';
import { handlers } from '@robis/worker/handlers';
import { mailHandlers } from '@robis/worker/mail';
import { Runner } from '@robis/worker/runner';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  getMailer,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Notifications by email (C3): a mention at once, everything else in at
 * most one digest a day, each with a link that stops it without signing in.
 * Done when: a kind turned off stops on every channel, and a digest job
 * retried three times sends one email.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const WEB = 'http://localhost:3000';
/** A day's digest hour, and the same day before it. */
const at = (day: string, hour: number) =>
  new Date(`${day}T${String(hour).padStart(2, '0')}:30:00Z`);
const DAY = '2026-11-20';

/** Upper bound on runner passes, so a job that keeps failing cannot spin. */
const MAX_TICKS = 20;

/** Run the queued notification jobs until none are left. */
async function runNotifyJobs() {
  const { workerDb: db } = await getHarness();
  // Only its own kinds: the mail jobs these queue are the mail runner's to send.
  const runner = new Runner({ db, handlers, kinds: Object.keys(handlers) });
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    if ((await runner.tick()).claimed === 0) break;
  }
}

async function mailTo(actor: Actor): Promise<Mail[]> {
  const mailer = await getMailer();
  return mailer.sent.filter((m) => m.to.toLowerCase() === actor.email.toLowerCase());
}

const set = (actor: Actor, kind: string, channel: string, enabled: boolean) =>
  request('/me/notification-settings', {
    method: 'PUT',
    payload: { kind, channel, enabled },
    actor,
  });

async function team() {
  const alice = await createActor('Alice');
  const bob = await createActor('Bob');
  const workspace = await createWorkspace(alice);
  const project = await createProject(alice, workspace.id);
  await addMember(alice, workspace.id, bob, 'MEMBER');
  // Signing up mailed each of them; only what follows is the subject here.
  (await getMailer()).clear();
  return { alice, bob, workspace, project };
}

async function giveIssue(
  alice: Actor,
  bob: Actor,
  workspaceId: string,
  projectId: string,
  title = 'Fix the export',
) {
  const response = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    payload: { title, assigneeId: bob.id },
    actor: alice,
  });
  expect(response.statusCode).toBe(201);
  await runNotifyJobs();
  return response.json().issue as { id: string; key: string };
}

async function mention(alice: Actor, bob: Actor, workspaceId: string, projectId: string) {
  const issue = (
    await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
      method: 'POST',
      payload: { title: 'Look at this' },
      actor: alice,
    })
  ).json().issue;
  await request(`/workspaces/${workspaceId}/issues/${issue.id}/comments`, {
    method: 'POST',
    payload: { body: `@${bob.username} can you check the numbers?` },
    actor: alice,
  });
  await runNotifyJobs();
  return issue as { id: string; key: string };
}

/** Queue the day's digests as the hourly scan would, then let the mail go. */
async function digestAt(now: Date) {
  const { workerDb: db } = await getHarness();
  await scanDigests(db, now);
}

const linkIn = (text: string, path: string) =>
  new RegExp(`${WEB}${path}\\?token=([^\\s]+)`).exec(text)?.[1];

describe('a mention', () => {
  test('is emailed at once, with the issue and a way to stop', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await mention(alice, bob, workspace.id, project.id);

    const [mail] = await mailTo(bob);
    expect(mail?.subject).toBe(`Alice mentioned you on ${issue.key}`);
    expect(mail?.text).toContain('can you check the numbers?');
    expect(mail?.text).toContain(`${WEB}/workspaces/${workspace.id}/issues/${issue.id}`);
    expect(linkIn(mail!.text, '/unsubscribe')).toBeTruthy();
    expect(mail?.headers?.['List-Unsubscribe']).toMatch(
      /^<http:\/\/localhost:3000\/unsubscribe\?token=/,
    );
    // Nothing to the one who wrote it.
    expect(await mailTo(alice)).toEqual([]);
  });

  test('with email off for mentions, stays in the app only', async () => {
    const { alice, bob, workspace, project } = await team();
    await set(bob, 'mention', 'email', false);
    await mention(alice, bob, workspace.id, project.id);
    expect(await mailTo(bob)).toEqual([]);
    const inbox = (await request('/notifications', { actor: bob })).json().notifications;
    expect(inbox.map((n: { kind: string }) => n.kind)).toEqual(['mention']);
  });

  test('is not emailed to an address never confirmed', async () => {
    const { alice, bob, workspace, project } = await team();
    const { ownerDb } = await getHarness();
    await ownerDb.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, bob.id));
    await mention(alice, bob, workspace.id, project.id);
    expect(await mailTo(bob)).toEqual([]);
  });
});

describe('a workspace that requires two-factor (C4)', () => {
  test('mails nothing from it to someone without it, even mail already waiting', async () => {
    const { alice, bob, workspace, project } = await team();
    await giveIssue(alice, bob, workspace.id, project.id);
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(workspaces)
      .set({ requireTwoFactor: true })
      .where(eq(workspaces.id, workspace.id));

    await digestAt(at(DAY, DIGEST_HOUR_UTC));
    expect(await mailTo(bob)).toEqual([]);
  });
});

describe('a burst of mentions', () => {
  test('past ten emails an hour, the rest wait for the digest', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        payload: { title: 'Busy thread' },
        actor: alice,
      })
    ).json().issue;
    for (let i = 0; i < MENTION_EMAILS_PER_HOUR + 2; i++) {
      await request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
        method: 'POST',
        payload: { body: `@${bob.username} number ${i}` },
        actor: alice,
      });
    }
    await runNotifyJobs();
    expect(await mailTo(bob)).toHaveLength(MENTION_EMAILS_PER_HOUR);

    await digestAt(at(DAY, DIGEST_HOUR_UTC));
    const all = await mailTo(bob);
    expect(all).toHaveLength(MENTION_EMAILS_PER_HOUR + 1);
    expect(all.at(-1)?.subject).toBe('Your Robis summary: 2 updates');
  });
});

describe('the daily digest', () => {
  test('waits for the digest hour, then sends one email for the day', async () => {
    const { alice, bob, workspace, project } = await team();
    const issue = await giveIssue(alice, bob, workspace.id, project.id);
    // An assignment is not mailed at once.
    expect(await mailTo(bob)).toEqual([]);

    await digestAt(at(DAY, DIGEST_HOUR_UTC - 1));
    expect(await mailTo(bob)).toEqual([]);

    await digestAt(at(DAY, DIGEST_HOUR_UTC));
    const [mail, ...more] = await mailTo(bob);
    expect(more).toEqual([]);
    expect(mail?.subject).toBe('Your Robis summary: 1 update');
    expect(mail?.text).toContain(`Alice gave you ${issue.key}: Fix the export`);
    expect(linkIn(mail!.text, '/unsubscribe')).toBeTruthy();

    // A later scan the same day sends nothing more, even with news.
    await giveIssue(alice, bob, workspace.id, project.id, 'Second one');
    await digestAt(at(DAY, DIGEST_HOUR_UTC + 3));
    expect(await mailTo(bob)).toHaveLength(1);

    // The next day's digest carries it.
    await digestAt(at('2026-11-21', DIGEST_HOUR_UTC));
    const all = await mailTo(bob);
    expect(all).toHaveLength(2);
    expect(all[1]?.text).toContain('Second one');
    expect(all[1]?.text).not.toContain('Fix the export');
  });

  test('a mention, already mailed, is not mailed again in the digest', async () => {
    const { alice, bob, workspace, project } = await team();
    await mention(alice, bob, workspace.id, project.id);
    await digestAt(at(DAY, DIGEST_HOUR_UTC));
    expect(await mailTo(bob)).toHaveLength(1);
  });

  test('leaves out a kind whose email was turned off since, and sends nothing if that was all', async () => {
    const { alice, bob, workspace, project } = await team();
    await giveIssue(alice, bob, workspace.id, project.id);
    await set(bob, 'assignment', 'email', false);
    await digestAt(at(DAY, DIGEST_HOUR_UTC));
    expect(await mailTo(bob)).toEqual([]);
  });

  test('a digest job retried three times sends one email', async () => {
    const { alice, bob, workspace, project } = await team();
    await giveIssue(alice, bob, workspace.id, project.id);
    const { workerDb: db } = await getHarness();

    // A mail server that fails twice, then takes the message.
    const sent: Mail[] = [];
    let failures = 2;
    const flaky: Mailer = {
      async send(mail) {
        if (failures-- > 0) throw new Error('421 try again later');
        sent.push(mail);
      },
    };
    const digest = mailHandlers({ mailer: flaky, webOrigin: WEB })['mail.digest']!;
    const payload = { userId: bob.id, day: DAY };

    await expect(digest(payload, { db })).rejects.toThrow('421');
    await expect(digest(payload, { db })).rejects.toThrow('421');
    await digest(payload, { db });
    // And once more after it went, as a redelivered job would.
    await digest(payload, { db });

    expect(sent).toHaveLength(1);
    const [row] = await db.select().from(emailDigests).where(eq(emailDigests.userId, bob.id));
    expect(row?.sentAt).not.toBeNull();
    const emailed = await db
      .select({ at: notifications.emailedAt })
      .from(notifications)
      .where(eq(notifications.userId, bob.id));
    expect(emailed.every((n) => n.at !== null)).toBe(true);
  });
});

describe('unsubscribing', () => {
  async function tokenFromDigest() {
    const { alice, bob, workspace, project } = await team();
    await giveIssue(alice, bob, workspace.id, project.id);
    await digestAt(at(DAY, DIGEST_HOUR_UTC));
    const [mail] = await mailTo(bob);
    return {
      bob,
      alice,
      workspace,
      project,
      token: decodeURIComponent(linkIn(mail!.text, '/unsubscribe')!),
    };
  }

  test('the link says what it stops, without signing in, and stops it', async () => {
    const { bob, token } = await tokenFromDigest();

    const preview = await request('/unsubscribe/preview', { method: 'POST', payload: { token } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().kinds).toEqual(['assignment']);

    const done = await request('/unsubscribe', { method: 'POST', payload: { token } });
    expect(done.statusCode).toBe(200);
    expect(done.json().kinds).toEqual(['assignment']);

    const settings = (await request('/me/notification-settings', { actor: bob })).json().settings;
    const assignment = settings.find((s: { kind: string }) => s.kind === 'assignment');
    // Email only: the app and push are left as they were.
    expect(assignment.channels).toEqual({ inApp: true, email: false, push: true });
  });

  test('works once, and a made-up token does nothing', async () => {
    const { token } = await tokenFromDigest();
    expect((await request('/unsubscribe', { method: 'POST', payload: { token } })).statusCode).toBe(
      200,
    );
    expect((await request('/unsubscribe', { method: 'POST', payload: { token } })).statusCode).toBe(
      404,
    );
    const fake = await request('/unsubscribe', {
      method: 'POST',
      payload: { token: 'x'.repeat(43) },
    });
    expect(fake.statusCode).toBe(404);
  });

  test('then the next digest leaves that kind out', async () => {
    const { alice, bob, workspace, project, token } = await tokenFromDigest();
    await request('/unsubscribe', { method: 'POST', payload: { token } });
    await giveIssue(alice, bob, workspace.id, project.id, 'After unsubscribing');
    await digestAt(at('2026-11-21', DIGEST_HOUR_UTC));
    expect(await mailTo(bob)).toHaveLength(1);
  });
});

describe('a kind turned off', () => {
  test('stops on every channel: no inbox entry and no email, at once or in the digest', async () => {
    const { alice, bob, workspace, project } = await team();
    for (const channel of ['in_app', 'email', 'push']) {
      await set(bob, 'mention', channel, false);
      await set(bob, 'assignment', channel, false);
    }
    await mention(alice, bob, workspace.id, project.id);
    await giveIssue(alice, bob, workspace.id, project.id);
    await digestAt(at(DAY, DIGEST_HOUR_UTC));

    expect(await mailTo(bob)).toEqual([]);
    expect((await request('/notifications', { actor: bob })).json().notifications).toEqual([]);
  });
});
