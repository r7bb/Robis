import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { commentMentions, eraseUsernameHistory, usernameHistory, users } from '@robis/database';
import { USERNAME_HOLD_DAYS, usernameKey, usernameProblem } from '@robis/shared';
import { handlers } from '@robis/worker/handlers';
import { eq, sql } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
  signUp,
} from './harness.ts';

/**
 * Usernames that cannot be worn by someone else: lookalikes are the same
 * name, a released name is held before anyone else may claim it, and a
 * mention points at the person it meant when it was written.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY_MS = 24 * 60 * 60 * 1000;

async function register(username: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return signUp({
    email: `${username.replace(/[^a-z0-9]/g, '')}-${stamp}@robis.test`,
    name: username,
    username,
    password: 'correct-horse-battery-staple',
    ageConfirmed: true,
  });
}

function rename(actor: Actor, username: string) {
  return request('/auth/me', { method: 'PATCH', actor, payload: { username } });
}

/** Moves every hold into the past, as if 90 days had gone by. */
async function expireHolds() {
  const { db } = await getHarness();
  await db
    .update(usernameHistory)
    .set({ heldUntil: new Date(Date.now() - DAY_MS) })
    .where(sql`true`);
}

describe('lookalike usernames', () => {
  test('dots, underscores, 0 and o, 1 and l all read as the same name', () => {
    expect(usernameKey('ada.l')).toBe(usernameKey('ada_l'));
    expect(usernameKey('ada_l')).toBe(usernameKey('adal'));
    expect(usernameKey('b0b')).toBe(usernameKey('bob'));
    expect(usernameKey('1ee')).toBe(usernameKey('lee'));
    expect(usernameKey('ada')).not.toBe(usernameKey('adb'));
  });

  test('the database derives the same key the code does', async () => {
    const { db } = await getHarness();
    const actor = await createActor();
    for (const name of ['ada.l_0v3', 'b0b.1ee', 'plain']) {
      await db.update(users).set({ username: name }).where(eq(users.id, actor.id));
      const [row] = await db
        .select({ key: users.usernameKey })
        .from(users)
        .where(eq(users.id, actor.id));
      expect(row?.key).toBe(usernameKey(name));
    }
  });

  test('a reserved name cannot be had by spelling it with a lookalike', () => {
    expect(usernameProblem('r0bis')).toBe('reserved');
    expect(usernameProblem('ad.min')).toBe('reserved');
    // 1 reads as an i as easily as an l.
    expect(usernameProblem('adm1n')).toBe('reserved');
    expect(usernameProblem('1ndex')).toBeNull();
  });

  test('signing up as a lookalike of a taken name is refused', async () => {
    expect((await register('ada.l')).statusCode).toBe(201);
    const second = await register('ada_l');
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe('username_taken');
  });

  test('renaming to a lookalike of someone else is refused, and the check says so', async () => {
    expect((await register('b0b')).statusCode).toBe(201);
    const actor = await createActor();
    const response = await rename(actor, 'bob');
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('username_taken');

    const check = await request('/auth/username-available?username=b.ob', { actor });
    expect(check.json()).toMatchObject({ available: false, reason: 'taken' });
  });

  test('your own name in another spelling is still yours', async () => {
    const actor = await createActor();
    expect((await rename(actor, 'ada.l')).statusCode).toBe(200);
    expect((await rename(actor, 'ada_l')).statusCode).toBe(200);
  });
});

describe('a released username', () => {
  test(`is held for ${USERNAME_HOLD_DAYS} days before anyone else can claim it`, async () => {
    const ada = await createActor('Ada');
    expect((await rename(ada, 'ada')).statusCode).toBe(200);
    expect((await rename(ada, 'ada.lovelace')).statusCode).toBe(200);

    const [hold] = await (await getHarness()).db
      .select()
      .from(usernameHistory)
      .where(eq(usernameHistory.username, 'ada'));
    expect(hold).toBeDefined();
    const days = (hold!.heldUntil.getTime() - hold!.releasedAt.getTime()) / DAY_MS;
    expect(Math.round(days)).toBe(USERNAME_HOLD_DAYS);

    const taken = await register('ada');
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toBe('username_held');

    const lookalike = await register('ad.a');
    expect(lookalike.json().error).toBe('username_held');

    const someone = await createActor();
    const check = await request('/auth/username-available?username=ada', { actor: someone });
    expect(check.json()).toMatchObject({ available: false, reason: 'held' });
    expect((await rename(someone, 'ada')).json().error).toBe('username_held');
  });

  test('cannot be taken by a sign-up racing the rename that releases it', async () => {
    for (let round = 0; round < 8; round++) {
      await resetDatabase();
      const ada = await createActor('Ada');
      await rename(ada, 'ada');
      const [renamed, signup] = await Promise.all([rename(ada, 'ada.lovelace'), register('ada')]);
      expect(renamed.statusCode).toBe(200);
      // Either it ran first and found Ada still there, or it found the hold.
      expect(signup.statusCode).toBe(409);
    }
  });

  test('an account can hold only a few names at once', async () => {
    const ada = await createActor('Ada');
    for (const name of ['ada.a', 'ada.b', 'ada.c']) {
      expect((await rename(ada, name)).statusCode).toBe(200);
    }
    const fourth = await rename(ada, 'ada.d');
    expect(fourth.statusCode).toBe(409);
    expect(fourth.json().error).toBe('too_many_renames');
    // Going back to a name you hold is not a new hold, so it is allowed.
    expect((await rename(ada, 'ada.a')).statusCode).toBe(200);
  });

  test('its owner can take it back while it is held', async () => {
    const ada = await createActor('Ada');
    await rename(ada, 'ada');
    await rename(ada, 'ada.lovelace');
    expect((await rename(ada, 'ada')).statusCode).toBe(200);
  });

  test('is free again once the hold runs out', async () => {
    const ada = await createActor('Ada');
    await rename(ada, 'ada');
    await rename(ada, 'ada.lovelace');
    await expireHolds();
    expect((await register('ada')).statusCode).toBe(201);
  });

  test('expired holds are swept away by the housekeeping job', async () => {
    const ada = await createActor('Ada');
    await rename(ada, 'ada');
    await rename(ada, 'ada.lovelace');
    await rename(ada, 'countess');
    const { db } = await getHarness();
    await db
      .update(usernameHistory)
      .set({ heldUntil: new Date(Date.now() - DAY_MS) })
      .where(eq(usernameHistory.username, 'ada'));

    await handlers['sessions.cleanup']!({}, { db: (await getHarness()).workerDb });

    const left = await db.select({ username: usernameHistory.username }).from(usernameHistory);
    const names = left.map((row) => row.username);
    expect(names).toContain('ada.lovelace');
    expect(names).not.toContain('ada');
  });

  test('a rename is recorded in your own account history, without the names', async () => {
    const ada = await createActor('Ada');
    await rename(ada, 'ada.lovelace');
    const history = await request('/auth/me/events', { actor: ada });
    const renamed = history
      .json()
      .events.find((event: { type: string }) => event.type === 'auth.username_changed');
    expect(renamed).toBeDefined();
    expect(JSON.stringify(renamed)).not.toContain('lovelace');
  });

  test('erasing a person removes their old names, but the hold stays', async () => {
    const ada = await createActor('Ada');
    await rename(ada, 'ada');
    await rename(ada, 'ada.lovelace');

    const { ownerDb } = await getHarness();
    expect(await eraseUsernameHistory(ownerDb, ada.id)).toBe(2);

    const rows = await ownerDb.select().from(usernameHistory);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.username === null && row.userId === null)).toBe(true);
    expect((await register('ada')).json().error).toBe('username_held');
  });
});

describe('a mention', () => {
  async function commentOn(actor: Actor, workspaceId: string, body: string) {
    const project = await createProject(actor, workspaceId);
    const issue = await request(`/workspaces/${workspaceId}/projects/${project.id}/issues`, {
      method: 'POST',
      actor,
      payload: { title: 'Ship the release' },
    });
    const issueId = issue.json().issue.id as string;
    const comment = await request(`/workspaces/${workspaceId}/issues/${issueId}/comments`, {
      method: 'POST',
      actor,
      payload: { body },
    });
    expect(comment.statusCode).toBe(201);
    return { issueId, commentId: comment.json().comment.id as string };
  }

  test('written before a rename still points at the person it meant', async () => {
    const author = await createActor('Author');
    const bob = await createActor('Bob');
    await rename(bob, 'bob');
    const workspace = await createWorkspace(author);
    await addMember(author, workspace.id, bob, 'MEMBER');

    const { issueId } = await commentOn(author, workspace.id, 'Over to you @bob, thanks');

    // Bob moves on, the hold runs out, and a new person takes the name.
    await rename(bob, 'robert');
    await expireHolds();
    const impostor = await createActor('Not Bob');
    expect((await rename(impostor, 'bob')).statusCode).toBe(200);
    await addMember(author, workspace.id, impostor, 'MEMBER');

    const thread = await request(`/workspaces/${workspace.id}/issues/${issueId}/comments`, {
      actor: author,
    });
    const [comment] = thread.json().comments;
    expect(comment.mentions).toEqual([{ handle: 'bob', userId: bob.id, username: 'robert' }]);
  });

  test('notifies the person it was resolved to when it was written', async () => {
    const author = await createActor('Author');
    const bob = await createActor('Bob');
    await rename(bob, 'bob');
    const workspace = await createWorkspace(author);
    await addMember(author, workspace.id, bob, 'MEMBER');
    const { commentId } = await commentOn(author, workspace.id, '@bob can you look?');

    // Renamed before the worker gets to it: the notice still reaches Bob.
    await rename(bob, 'robert');
    const { workerDb } = await getHarness();
    await handlers['notify.mentions']!({ commentId }, { db: workerDb });

    const inbox = await request('/notifications', { actor: bob });
    expect(inbox.json().notifications).toHaveLength(1);
  });

  test('of someone outside the workspace resolves to nobody', async () => {
    const author = await createActor('Author');
    const outsider = await createActor('Outsider');
    await rename(outsider, 'outsider');
    const workspace = await createWorkspace(author);
    const { commentId } = await commentOn(author, workspace.id, 'cc @outsider');

    const { db } = await getHarness();
    const rows = await db
      .select()
      .from(commentMentions)
      .where(eq(commentMentions.commentId, commentId));
    expect(rows).toHaveLength(0);
  });
});
