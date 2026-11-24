import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { placeReply } from '@robis/api/space-replies';
import { spaceReplies } from '@robis/database';
import { SPACE_REPLY_DEPTH_MAX } from '@robis/shared';
import { eq } from 'drizzle-orm';
import {
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Spaces: topics within the workspace where a question gets a thread,
 * replies nest, the asker marks the answer, and reactions say what helped.
 * Done when a member can ask, a guest can answer, the asker (or an admin)
 * marks the answer, the most helpful lists count only marks from other
 * people, and nobody outside the workspace sees any of it.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const guest = await createActor('Guest');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  await addMember(owner, workspace.id, guest, 'GUEST');
  return { owner, member, guest, ws: `/workspaces/${workspace.id}` };
}

async function made<T>(
  actor: Actor,
  url: string,
  payload: unknown,
  key: string,
): Promise<T & { id: string }> {
  const response = await request(url, { method: 'POST', actor, payload });
  if (response.statusCode !== 201)
    throw new Error(`${url}: ${response.statusCode} ${response.body}`);
  return response.json()[key];
}

const space = (actor: Actor, ws: string, name = 'Help desk') =>
  made<{ name: string }>(actor, `${ws}/spaces`, { name, description: 'Ask anything' }, 'space');
const thread = (actor: Actor, ws: string, spaceId: string, title = 'VPN drops at noon') =>
  made<{ kind: string }>(
    actor,
    `${ws}/spaces/${spaceId}/threads`,
    { kind: 'question', title, body: 'Every day, right at noon.' },
    'thread',
  );
const reply = (actor: Actor, ws: string, threadId: string, body: string, parentId?: string) =>
  made<{ depth: number; parentId: string | null }>(
    actor,
    `${ws}/space-threads/${threadId}/replies`,
    { body, ...(parentId ? { parentId } : {}) },
    'reply',
  );
const react = (actor: Actor, ws: string, targetId: string, reaction: string, on = true) =>
  request(`${ws}/space-reactions/${targetId}/${reaction}`, {
    method: on ? 'PUT' : 'DELETE',
    actor,
  });

describe('spaces and threads', () => {
  test('a member starts a space and asks; the space lists it with its count', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(member, ws);
    await thread(member, ws, desk.id);
    const { spaces } = (await request(`${ws}/spaces`, { actor: owner })).json();
    expect(spaces).toHaveLength(1);
    expect(spaces[0]).toMatchObject({ name: 'Help desk', threadCount: 1 });
    expect(spaces[0].lastActivityAt).not.toBeNull();
  });

  test('a name is used once per workspace, whatever its case', async () => {
    const { owner, ws } = await team();
    await space(owner, ws, 'Design');
    const again = await request(`${ws}/spaces`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'design' },
    });
    expect(again.statusCode).toBe(409);
  });

  test('a guest may reply but not start a space or a thread', async () => {
    const { owner, guest, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const startSpace = await request(`${ws}/spaces`, {
      method: 'POST',
      actor: guest,
      payload: { name: 'Mine' },
    });
    expect(startSpace.statusCode).toBe(403);
    const startThread = await request(`${ws}/spaces/${desk.id}/threads`, {
      method: 'POST',
      actor: guest,
      payload: { kind: 'idea', title: 'Mine' },
    });
    expect(startThread.statusCode).toBe(403);
    await reply(guest, ws, asked.id, 'Try the other gateway.');
  });

  test('nobody outside the workspace sees a space, a thread or a reply', async () => {
    const { owner, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const answer = await reply(owner, ws, asked.id, 'Restart it.');
    const stranger = await createActor('Stranger');
    for (const url of [
      `${ws}/spaces`,
      `${ws}/spaces/${desk.id}/threads`,
      `${ws}/space-threads/${asked.id}`,
    ]) {
      expect((await request(url, { actor: stranger })).statusCode).toBe(404);
    }
    expect((await react(stranger, ws, answer.id, 'helpful')).statusCode).toBe(404);
    // Another workspace's thread, asked for through your own, is not found either.
    const theirs = await createWorkspace(stranger, 'Elsewhere');
    expect(
      (await request(`/workspaces/${theirs.id}/space-threads/${asked.id}`, { actor: stranger }))
        .statusCode,
    ).toBe(404);
  });
});

describe('replies', () => {
  test('nest under the reply they answer, and the thread reads them with their parents', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const first = await reply(member, ws, asked.id, 'Is it the Wi-Fi?');
    const nested = await reply(owner, ws, asked.id, 'Wired too.', first.id);
    expect(nested).toMatchObject({ parentId: first.id, depth: 1 });
    const read = (await request(`${ws}/space-threads/${asked.id}`, { actor: member })).json();
    expect(read.replies.map((r: { id: string }) => r.id)).toEqual([first.id, nested.id]);
    expect(read.thread.replyCount).toBe(2);
    expect(read.truncated).toBe(false);
  });

  test('a reply to a reply in another thread is refused', async () => {
    const { owner, ws } = await team();
    const desk = await space(owner, ws);
    const one = await thread(owner, ws, desk.id, 'One');
    const two = await thread(owner, ws, desk.id, 'Two');
    const there = await reply(owner, ws, one.id, 'Over here.');
    const crossed = await request(`${ws}/space-threads/${two.id}/replies`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Mixed up', parentId: there.id },
    });
    expect(crossed.statusCode).toBe(400);
  });

  test('past the deepest level, a reply sits beside its parent', () => {
    const deepest = { id: 'deep', parentId: 'above', depth: SPACE_REPLY_DEPTH_MAX };
    expect(placeReply(deepest)).toEqual({ parentId: 'above', depth: SPACE_REPLY_DEPTH_MAX });
    expect(placeReply({ id: 'top', parentId: null, depth: 0 })).toEqual({
      parentId: 'top',
      depth: 1,
    });
    expect(placeReply(null)).toEqual({ parentId: null, depth: 0 });
  });

  test('taken down, a reply keeps its place without its words; only its writer or an admin may', async () => {
    const { owner, member, guest, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const first = await reply(guest, ws, asked.id, 'Something to regret.');
    await reply(member, ws, asked.id, 'Under it.', first.id);
    expect(
      (await request(`${ws}/space-replies/${first.id}`, { method: 'DELETE', actor: member }))
        .statusCode,
    ).toBe(403);
    expect(
      (await request(`${ws}/space-replies/${first.id}`, { method: 'DELETE', actor: guest }))
        .statusCode,
    ).toBe(204);
    const read = (await request(`${ws}/space-threads/${asked.id}`, { actor: owner })).json();
    expect(read.replies[0]).toMatchObject({ id: first.id, deleted: true, body: '' });
    expect(read.replies[1].parentId).toBe(first.id);
    expect(read.thread.replyCount).toBe(1);
  });
});

describe('the answer', () => {
  test('whoever asked marks it; another member may not; a non-question has none', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(member, ws, desk.id);
    const answer = await reply(owner, ws, asked.id, 'Turn off the noon backup.');
    const path = `${ws}/space-threads/${asked.id}/answer`;

    const someoneElse = await createActor('Other');
    await addMember(owner, ws.split('/')[2]!, someoneElse, 'MEMBER');
    expect(
      (await request(path, { method: 'PUT', actor: someoneElse, payload: { replyId: answer.id } }))
        .statusCode,
    ).toBe(403);
    const marked = await request(path, {
      method: 'PUT',
      actor: member,
      payload: { replyId: answer.id },
    });
    expect(marked.json<{ solvedReplyId: string }>()).toEqual({ solvedReplyId: answer.id });
    const unanswered = (
      await request(`${ws}/spaces/${desk.id}/threads?sort=unanswered`, { actor: owner })
    ).json();
    expect(unanswered.threads).toHaveLength(0);

    const idea = await made<{ id: string }>(
      owner,
      `${ws}/spaces/${desk.id}/threads`,
      { kind: 'idea', title: 'Snacks on Friday' },
      'thread',
    );
    const wrong = await request(`${ws}/space-threads/${idea.id}/answer`, {
      method: 'PUT',
      actor: owner,
      payload: { replyId: null },
    });
    expect(wrong.statusCode).toBe(400);
  });

  test('taking down the answer clears it', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(member, ws, desk.id);
    const answer = await reply(owner, ws, asked.id, 'This.');
    await request(`${ws}/space-threads/${asked.id}/answer`, {
      method: 'PUT',
      actor: member,
      payload: { replyId: answer.id },
    });
    await request(`${ws}/space-replies/${answer.id}`, { method: 'DELETE', actor: owner });
    const read = (await request(`${ws}/space-threads/${asked.id}`, { actor: member })).json();
    expect(read.thread).toMatchObject({ solvedReplyId: null, solved: false });
  });
});

describe('reactions and the most helpful', () => {
  test('reactions on threads and replies show who; a thread with more sorts first under top', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const quiet = await thread(owner, ws, desk.id, 'Quiet');
    const loved = await thread(owner, ws, desk.id, 'Loved');
    await thread(owner, ws, desk.id, 'Newest');
    expect((await react(member, ws, loved.id, 'insightful')).statusCode).toBe(204);
    expect((await react(owner, ws, loved.id, 'celebrate')).statusCode).toBe(204);
    expect((await react(owner, ws, quiet.id, 'thanks')).statusCode).toBe(204);
    const top = (
      await request(`${ws}/spaces/${desk.id}/threads?sort=top`, { actor: owner })
    ).json();
    expect(top.threads[0]).toMatchObject({ id: loved.id });
    expect(top.threads[0].reactions.insightful).toEqual([member.id]);
  });

  test('count Helpful marks from other people, and answers to other people’s questions', async () => {
    const { owner, member, guest, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const good = await reply(member, ws, asked.id, 'Move the backup to midnight.');
    const own = await reply(guest, ws, asked.id, 'Me too.');
    await react(owner, ws, good.id, 'helpful');
    await react(guest, ws, good.id, 'helpful');
    // Marking your own reply helpful counts for nothing.
    await react(guest, ws, own.id, 'helpful');
    await request(`${ws}/space-threads/${asked.id}/answer`, {
      method: 'PUT',
      actor: owner,
      payload: { replyId: good.id },
    });

    for (const period of ['week', 'month', 'all']) {
      const leaders = (
        await request(`${ws}/spaces-leaders?period=${period}`, { actor: guest })
      ).json();
      expect(leaders.people).toEqual([{ userId: member.id, helpful: 2, answers: 1 }]);
      expect(leaders.replies).toHaveLength(1);
      expect(leaders.replies[0]).toMatchObject({
        replyId: good.id,
        helpful: 2,
        answer: true,
        spaceName: 'Help desk',
      });
    }
  });

  test('a reply taken down takes its reactions with it', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const gone = await reply(member, ws, asked.id, 'Oops.');
    await react(owner, ws, gone.id, 'helpful');
    await request(`${ws}/space-replies/${gone.id}`, { method: 'DELETE', actor: member });
    expect((await react(owner, ws, gone.id, 'helpful')).statusCode).toBe(404);
    const leaders = (await request(`${ws}/spaces-leaders?period=all`, { actor: owner })).json();
    expect(leaders.people).toEqual([]);
  });

  test('a thread taken down by an admin goes with its replies', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(member, ws, desk.id);
    const answer = await reply(owner, ws, asked.id, 'Done.');
    await request(`${ws}/space-threads/${asked.id}/answer`, {
      method: 'PUT',
      actor: member,
      payload: { replyId: answer.id },
    });
    expect(
      (await request(`${ws}/space-threads/${asked.id}`, { method: 'DELETE', actor: owner }))
        .statusCode,
    ).toBe(204);
    expect((await request(`${ws}/space-threads/${asked.id}`, { actor: owner })).statusCode).toBe(
      404,
    );
  });
});

describe('what the review asked for', () => {
  test('Helpful marks from someone who has left stop counting', async () => {
    const { owner, member, guest, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const good = await reply(member, ws, asked.id, 'Try this.');
    await react(guest, ws, good.id, 'helpful');
    await react(owner, ws, good.id, 'helpful');
    const removed = await request(`${ws}/members/${guest.id}`, { method: 'DELETE', actor: owner });
    expect(removed.statusCode).toBe(204);
    const leaders = (await request(`${ws}/spaces-leaders?period=all`, { actor: owner })).json();
    expect(leaders.people).toEqual([{ userId: member.id, helpful: 1, answers: 0 }]);
    expect(leaders.replies[0].helpful).toBe(1);
  });

  test('an answer counts in the week it was marked, not when the reply was written', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const old = await reply(member, ws, asked.id, 'Written long ago.');
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(spaceReplies)
      .set({ createdAt: new Date(Date.now() - 90 * 86_400_000) })
      .where(eq(spaceReplies.id, old.id));
    await request(`${ws}/space-threads/${asked.id}/answer`, {
      method: 'PUT',
      actor: owner,
      payload: { replyId: old.id },
    });
    const week = (await request(`${ws}/spaces-leaders?period=week`, { actor: owner })).json();
    expect(week.people).toEqual([{ userId: member.id, helpful: 0, answers: 1 }]);
  });

  test('a reply taken down cannot be marked the answer', async () => {
    const { owner, member, ws } = await team();
    const desk = await space(owner, ws);
    const asked = await thread(owner, ws, desk.id);
    const gone = await reply(member, ws, asked.id, 'Never mind.');
    await request(`${ws}/space-replies/${gone.id}`, { method: 'DELETE', actor: member });
    const marked = await request(`${ws}/space-threads/${asked.id}/answer`, {
      method: 'PUT',
      actor: owner,
      payload: { replyId: gone.id },
    });
    expect(marked.statusCode).toBe(400);
    const read = (await request(`${ws}/space-threads/${asked.id}`, { actor: owner })).json();
    expect(read.thread.solved).toBe(false);
  });
});
