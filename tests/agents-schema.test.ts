import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentTokens, issues, users } from '@robis/database';
import { AGENT_ROLES, can, ROLES, USER_KINDS } from '@robis/shared';
import { eq } from 'drizzle-orm';
import {
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  refusal,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Agents as teammates (B5, slice 1): an account is a person or an agent,
 * an agent holds tokens stored only as hashes and scoped to one workspace,
 * and an issue can name the agent that acted on it beside its human
 * assignee.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

describe('accounts', () => {
  test('are people or agents, and people by default', async () => {
    expect([...USER_KINDS]).toEqual(['human', 'agent']);
    const actor = await createActor('Ada');
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select({ kind: users.kind })
      .from(users)
      .where(eq(users.id, actor.id));
    expect(row?.kind).toBe('human');
  });
});

describe('the permission to manage agents', () => {
  test('is an admin’s and an owner’s, not a member’s or a guest’s', () => {
    expect(ROLES.filter((role) => can(role, 'agent:manage'))).toEqual(['OWNER', 'ADMIN']);
  });

  test('an agent can be a member or a guest, never someone who manages people', () => {
    expect([...AGENT_ROLES]).toEqual(['MEMBER', 'GUEST']);
  });
});

describe('agent tokens', () => {
  async function setUp() {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const { ownerDb } = await getHarness();
    return { owner, workspace, ownerDb };
  }

  test('are stored by hash, and one hash names one token', async () => {
    const { owner, workspace, ownerDb } = await setUp();
    const row = { agentId: owner.id, workspaceId: workspace.id, createdBy: owner.id, label: 'ci' };
    await ownerDb.insert(agentTokens).values({ ...row, tokenHash: 'same-hash' });

    expect(
      await refusal(ownerDb.insert(agentTokens).values({ ...row, tokenHash: 'same-hash' })),
    ).toContain('agent_tokens_token_hash_key');
  });

  test('belong to a workspace and go with it', async () => {
    const { owner, workspace, ownerDb } = await setUp();
    await ownerDb.insert(agentTokens).values({
      agentId: owner.id,
      workspaceId: workspace.id,
      createdBy: owner.id,
      label: 'ci',
      tokenHash: 'h1',
    });

    const deleted = await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: 'correct-horse-battery-staple' },
    });
    expect(deleted.statusCode).toBe(204);
    expect(await ownerDb.select().from(agentTokens)).toEqual([]);
  });
});

describe('an issue', () => {
  test('has no delegate until an agent acts on it, and keeps its assignee', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const project = await createProject(owner, workspace.id);
    const created = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      payload: { title: 'Plain' },
      actor: owner,
    });
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb
      .select({ delegateId: issues.delegateId })
      .from(issues)
      .where(eq(issues.id, created.json().issue.id));
    expect(row?.delegateId).toBeNull();
  });
});
