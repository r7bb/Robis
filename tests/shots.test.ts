import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentTokens, stories } from '@robis/database';
import { SHOT_IDEAS, shotFor, shotsHandler } from '@robis/worker/shots';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type Actor,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';
import { mcpFetch } from './mcp-harness.ts';

/**
 * Different shots (Phase 2c): the workspace's chosen agent posts an idea a
 * day as a story with a Try it, through the MCP server like any agent call.
 * Done when: one a day however often the job runs, only where an agent was
 * chosen and stories are on, its Try it only ever opens a place in Robis,
 * and its run token is revoked when the run ends.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY = new Date('2026-11-20T09:00:00Z');
const run =
  (now = DAY) =>
  async () => {
    const handler = shotsHandler({
      mcpUrl: 'http://mcp.internal',
      fetcher: mcpFetch,
      now: () => now,
    });
    await handler({}, { db: (await getHarness()).workerDb });
  };

async function setUp({ shots = true, role = 'MEMBER' } = {}) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const created = await request(`/workspaces/${workspace.id}/agents`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'Ideas bot', role, shots },
  });
  return { owner, workspace, agentId: created.json().agent.id as string };
}

const listed = async (actor: Actor, workspaceId: string) =>
  (await request(`/workspaces/${workspaceId}/stories`, { actor })).json().stories as {
    authorId: string;
    body: string;
    tryPath: string | null;
    tryLabel: string | null;
  }[];

describe('posting a shot', () => {
  test('the chosen agent posts today’s idea as a story with a Try it, once a day', async () => {
    const { owner, workspace, agentId } = await setUp();
    await run()();
    await run()();
    const shots = await listed(owner, workspace.id);
    expect(shots).toHaveLength(1);
    const expected = shotFor(workspace.id, DAY);
    expect(shots[0]).toMatchObject({
      authorId: agentId,
      body: expected.body,
      tryPath: expected.tryPath,
      tryLabel: expected.tryLabel,
    });
    expect(
      shots[0]!.tryPath!.startsWith(`/workspaces/${workspace.id}`) ||
        shots[0]!.tryPath!.startsWith('/account'),
    ).toBe(true);

    // The next day, the next idea.
    await run(new Date(DAY.getTime() + 86_400_000))();
    expect(await listed(owner, workspace.id)).toHaveLength(2);

    // Its run tokens were revoked as each run ended.
    const { ownerDb } = await getHarness();
    const open = await ownerDb
      .select()
      .from(agentTokens)
      .where(
        and(
          eq(agentTokens.agentId, agentId),
          eq(agentTokens.label, 'shots run'),
          isNull(agentTokens.revokedAt),
        ),
      );
    expect(open).toEqual([]);
  });

  test('nothing without a chosen agent, or with stories off; a guest agent is refused', async () => {
    const none = await setUp({ shots: false });
    await run()();
    expect(await listed(none.owner, none.workspace.id)).toEqual([]);

    const off = await setUp();
    await request(`/workspaces/${off.workspace.id}/stories-enabled`, {
      method: 'PUT',
      actor: off.owner,
      payload: { enabled: false },
    });
    await run()();
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(stories).where(eq(stories.workspaceId, off.workspace.id)),
    ).toEqual([]);

    const guest = await setUp({ role: 'GUEST' });
    await run()();
    expect(await listed(guest.owner, guest.workspace.id)).toEqual([]);
  });

  test('removing the agent stops its shots', async () => {
    const { owner, workspace, agentId } = await setUp();
    await request(`/workspaces/${workspace.id}/agents/${agentId}`, {
      method: 'DELETE',
      actor: owner,
    });
    await run()();
    expect(await listed(owner, workspace.id)).toEqual([]);
  });
});

describe('a Try it', () => {
  test('opens only a place in this workspace or the account page', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const other = await createWorkspace(owner, 'Other');
    const post = (tryPath: string) =>
      request(`/workspaces/${workspace.id}/stories`, {
        method: 'POST',
        actor: owner,
        payload: { body: 'Try this', tone: 'sea', tryPath, tryLabel: 'Try it' },
      });
    expect((await post(`/workspaces/${workspace.id}/feed`)).statusCode).toBe(201);
    expect((await post('/account#passkeys')).statusCode).toBe(201);
    for (const bad of [
      `/workspaces/${other.id}/feed`,
      'https://evil.example/',
      '//evil.example',
      '/login',
      '/workspaces/../account',
    ]) {
      expect((await post(bad)).statusCode).toBe(400);
    }
    // A place without its words, or words without a place, is not a Try it.
    const half = await request(`/workspaces/${workspace.id}/stories`, {
      method: 'POST',
      actor: owner,
      payload: { body: 'Half', tone: 'sea', tryPath: `/workspaces/${workspace.id}/feed` },
    });
    expect(half.statusCode).toBe(400);
  });

  test('every written idea opens a place in Robis', () => {
    for (const idea of SHOT_IDEAS) {
      expect(
        idea.tryPath.startsWith('/workspaces/{ws}') || idea.tryPath.startsWith('/account'),
      ).toBe(true);
      expect(idea.body.length).toBeLessThanOrEqual(280);
      expect(idea.tryLabel.length).toBeLessThanOrEqual(24);
    }
  });
});
