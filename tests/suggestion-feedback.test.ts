import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestionFeedback } from '@robis/database';
import { OFFLINE_DUPLICATE_EVALUATION } from '@robis/shared';
import {
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Hint feedback (B6, slice 4): what people do with the composer's hints,
 * counted per workspace without naming anyone, and shown beside the offline
 * evaluation, which is a different measurement.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const member = await createActor('Member');
  await addMember(owner, workspace.id, member, 'MEMBER');
  const send = (
    actor = member,
    body: object = { kind: 'priority', action: 'accepted', score: 0.8 },
  ) =>
    request(`/workspaces/${workspace.id}/suggestions/feedback`, {
      method: 'POST',
      actor,
      payload: body,
    });
  return { owner, member, workspace, send };
}

describe('feedback', () => {
  test('is recorded without naming anyone', async () => {
    const { send } = await setUp();
    expect((await send()).statusCode).toBe(204);
    const { ownerDb } = await getHarness();
    const rows = await ownerDb.select().from(suggestionFeedback);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'priority', action: 'accepted', score: 0.8 });
    expect(Object.keys(rows[0]!)).not.toContain('userId');
  });

  test('a stranger is told nothing, and a bad kind is refused', async () => {
    const { send } = await setUp();
    expect((await send(await createActor('Stranger'))).statusCode).toBe(404);
    expect((await send(undefined, { kind: 'mood', action: 'accepted' })).statusCode).toBe(400);
  });

  test('one person cannot flood a workspace’s figures', async () => {
    const { send } = await setUp();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await send()).statusCode);
    expect(statuses.filter((s) => s === 204)).toHaveLength(60);
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('the figures', () => {
  test('match a seeded set of accepts and dismisses', async () => {
    const { owner, workspace, send } = await setUp();
    const seeded = [
      ...Array(3).fill({ kind: 'duplicate', action: 'accepted', score: 0.7 }),
      ...Array(5).fill({ kind: 'duplicate', action: 'dismissed', score: 0.45 }),
      ...Array(4).fill({ kind: 'priority', action: 'accepted', score: 0.9 }),
      { kind: 'priority', action: 'dismissed', score: 0.5 },
    ];
    for (const body of seeded) await send(undefined, body);

    const stats = await request(`/workspaces/${workspace.id}/suggestions/stats`, { actor: owner });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().live).toEqual({
      duplicate: { accepted: 3, dismissed: 5 },
      priority: { accepted: 4, dismissed: 1 },
    });
  });

  test('come with the offline evaluation, as robis-ml reports it', async () => {
    const { owner, workspace } = await setUp();
    const stats = await request(`/workspaces/${workspace.id}/suggestions/stats`, { actor: owner });
    expect(stats.json().offline).toEqual({
      duplicate: OFFLINE_DUPLICATE_EVALUATION,
      priority: null,
    });

    const readme = readFileSync(join(import.meta.dir, '..', 'robis-ml', 'README.md'), 'utf8');
    const e = OFFLINE_DUPLICATE_EVALUATION;
    expect(readme).toContain(`| Precision | ${e.precision} |`);
    expect(readme).toContain(`${e.correctHints} / ${e.hints} hints`);
    expect(readme).toContain(`| Recall | ${e.recall} |`);
    expect(readme).toContain(`${e.foundPairs} / ${e.pairs} pairs`);
    expect(readme).toContain(`picks **${e.threshold.toFixed(2)}**`);
  });

  test('are for admins', async () => {
    const { member, workspace } = await setUp();
    const stats = await request(`/workspaces/${workspace.id}/suggestions/stats`, { actor: member });
    expect(stats.statusCode).toBe(403);
  });
});

describe('what the review asked for', () => {
  test('an agent cannot add to the figures', async () => {
    const { owner, workspace } = await setUp();
    const created = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Opinion bot', role: 'MEMBER' },
    });
    const response = await request(`/workspaces/${workspace.id}/suggestions/feedback`, {
      method: 'POST',
      headers: { authorization: `Bearer ${created.json().token.secret}` },
      payload: { kind: 'priority', action: 'accepted' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('people_only');
  });
});
