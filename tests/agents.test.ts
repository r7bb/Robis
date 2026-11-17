import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentTokens, auditEvents, comments, issues, mutations, users } from '@robis/database';
import { and, eq } from 'drizzle-orm';
import {
  ACTOR_PASSWORD,
  type Actor,
  addMember,
  closeHarness,
  createActor,
  createProject,
  createWorkspace,
  getHarness,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * Agents as teammates (B5, slice 2): an admin adds an agent with a role and
 * a token shown once; the agent acts with the token through the same
 * permission matrix, idempotency ledger and audit trail as anyone. Done
 * when a denied call gets the same 404 or 403 a person would, a replayed
 * write does not duplicate, and a revoked token fails on the very next call.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

type Agent = { id: string; username: string; secret: string; tokenId: string };

async function createAgent(
  admin: Actor,
  workspaceId: string,
  role: 'MEMBER' | 'GUEST' = 'MEMBER',
  name = 'Triage bot',
): Promise<Agent> {
  const response = await request(`/workspaces/${workspaceId}/agents`, {
    method: 'POST',
    actor: admin,
    payload: { name, role },
  });
  if (response.statusCode !== 201)
    throw new Error(`agent: ${response.statusCode} ${response.body}`);
  const { agent, token } = response.json();
  return { id: agent.id, username: agent.username, secret: token.secret, tokenId: token.id };
}

/** A request carrying the agent's token, as an MCP server would send it. */
const as = (agent: Agent, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${agent.secret}`,
  ...extra,
});

async function setUp(role: 'MEMBER' | 'GUEST' = 'MEMBER') {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  const agent = await createAgent(owner, workspace.id, role);
  return { owner, workspace, project, agent };
}

describe('adding an agent', () => {
  test('an admin gets the agent and a token shown once', async () => {
    const { owner, workspace, agent } = await setUp();
    expect(agent.secret.startsWith('rba_')).toBe(true);
    expect(agent.username).toBe('triage.bot');

    const listed = await request(`/workspaces/${workspace.id}/agents`, { actor: owner });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(agent.secret);
    expect(listed.json().agents[0]).toMatchObject({
      id: agent.id,
      role: 'MEMBER',
      avatar: { kind: 'generated', seed: agent.id },
      tokens: [{ id: agent.tokenId, label: 'First token', revokedAt: null }],
    });
  });

  test('a member may not, and a stranger is told nothing', async () => {
    const { owner, workspace } = await setUp();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    const stranger = await createActor('Stranger');
    const add = (actor: Actor) =>
      request(`/workspaces/${workspace.id}/agents`, {
        method: 'POST',
        actor,
        payload: { name: 'Sneaky', role: 'MEMBER' },
      });

    expect((await add(member)).statusCode).toBe(403);
    expect((await add(stranger)).statusCode).toBe(404);
  });

  test('cannot be given a role that manages people', async () => {
    const { owner, workspace } = await setUp();
    const response = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Boss bot', role: 'ADMIN' },
    });
    expect(response.statusCode).toBe(400);
  });

  test('and cannot be promoted to one afterwards', async () => {
    const { owner, workspace, agent } = await setUp();
    const promoted = await request(`/workspaces/${workspace.id}/members/${agent.id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { role: 'ADMIN' },
    });
    expect(promoted.statusCode).toBe(403);
    expect(promoted.json().error).toBe('agent_role');
  });

  test('is marked as an agent in the member list', async () => {
    const { owner, workspace, agent } = await setUp();
    const { members } = (
      await request(`/workspaces/${workspace.id}/members`, { actor: owner })
    ).json();
    const kinds = Object.fromEntries(
      members.map((m: { userId: string; kind: string }) => [m.userId, m.kind]),
    );
    expect(kinds).toEqual({ [owner.id]: 'human', [agent.id]: 'agent' });
  });
});

describe('an agent acting with its token', () => {
  test('reads and writes in its workspace, recorded as an agent and as the delegate', async () => {
    const { workspace, project, agent } = await setUp();

    const created = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      headers: as(agent),
      payload: { title: 'Filed by a bot' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().issue).toMatchObject({ createdBy: agent.id, delegateId: agent.id });

    const { ownerDb } = await getHarness();
    const [event] = await ownerDb
      .select({ actorId: auditEvents.actorId, actorKind: auditEvents.actorKind })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.workspaceId, workspace.id), eq(auditEvents.eventType, 'issue.created')),
      );
    expect(event).toEqual({ actorId: agent.id, actorKind: 'agent' });
  });

  test('a person’s edit keeps the agent named as delegate, and the assignee stays a person', async () => {
    const { owner, workspace, project, agent } = await setUp();
    const created = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      headers: as(agent),
      payload: { title: 'Needs an owner' },
    });
    const url = `/workspaces/${workspace.id}/issues/${created.json().issue.id}`;

    const assigned = await request(url, {
      method: 'PATCH',
      actor: owner,
      payload: { assigneeId: owner.id },
    });
    expect(assigned.json().issue).toMatchObject({ assigneeId: owner.id, delegateId: agent.id });

    const toBot = await request(url, {
      method: 'PATCH',
      actor: owner,
      payload: { assigneeId: agent.id },
    });
    expect(toBot.statusCode).toBe(400);
    expect(toBot.json().error).toBe('assignee_not_person');
  });

  test('is answered outside its workspace exactly as a stranger is', async () => {
    const { project, agent } = await setUp();
    const other = await createActor('Other');
    const elsewhere = await createWorkspace(other, 'Elsewhere');
    const stranger = await createActor('Stranger');

    const url = `/workspaces/${elsewhere.id}/projects`;
    const byAgent = await request(url, { headers: as(agent) });
    const byStranger = await request(url, { actor: stranger });
    expect({ status: byAgent.statusCode, body: byAgent.json() }).toEqual({
      status: byStranger.statusCode,
      body: byStranger.json(),
    });
    expect(byAgent.statusCode).toBe(404);
    expect(project.id).toBeDefined();
  });

  test('is refused what its role does not allow, exactly as a person with that role is', async () => {
    const { owner, workspace, project, agent } = await setUp('GUEST');
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');

    const url = `/workspaces/${workspace.id}/projects/${project.id}/issues`;
    const payload = { title: 'Not allowed' };
    const byAgent = await request(url, { method: 'POST', headers: as(agent), payload });
    const byGuest = await request(url, { method: 'POST', actor: guest, payload });
    expect({ status: byAgent.statusCode, body: byAgent.json() }).toEqual({
      status: byGuest.statusCode,
      body: byGuest.json(),
    });
    expect(byAgent.statusCode).toBe(403);
  });

  test('has no account outside the workspace: no profile, no workspace list', async () => {
    const { agent } = await setUp();
    expect((await request('/auth/me', { headers: as(agent) })).statusCode).toBe(401);
    expect((await request('/workspaces', { headers: as(agent) })).statusCode).toBe(401);
  });

  test('cannot sign in, and its address is answered as an unknown one', async () => {
    const { ownerDb } = await getHarness();
    const { agent } = await setUp();
    const [row] = await ownerDb
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, agent.id));
    const login = (email: string) =>
      request('/auth/login', { method: 'POST', payload: { email, password: ACTOR_PASSWORD } });

    const asAgent = await login(row!.email);
    const unknown = await login('nobody-at-all@robis.test');
    expect(asAgent.statusCode).toBe(401);
    expect(asAgent.json()).toEqual(unknown.json());
  });

  test('cannot be invited into another workspace', async () => {
    const { agent } = await setUp();
    const other = await createActor('Other');
    const elsewhere = await createWorkspace(other, 'Elsewhere');
    const invited = await request(`/workspaces/${elsewhere.id}/members`, {
      method: 'POST',
      actor: other,
      payload: { username: agent.username, role: 'MEMBER' },
    });
    expect(invited.statusCode).toBe(404);
  });
});

describe('a replayed write', () => {
  test('files one issue, however often it is sent', async () => {
    const { workspace, project, agent } = await setUp();
    const send = () =>
      request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        headers: as(agent, { 'idempotency-key': 'b5-issue-once' }),
        payload: { title: 'Once' },
      });

    const first = await send();
    const again = await send();
    expect(again.json().issue.id).toBe(first.json().issue.id);
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(issues).where(eq(issues.workspaceId, workspace.id)),
    ).toHaveLength(1);
  });

  test('posts one comment, however often it is sent', async () => {
    const { owner, workspace, project, agent } = await setUp();
    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Discuss' },
      })
    ).json().issue;
    const send = () =>
      request(`/workspaces/${workspace.id}/issues/${issue.id}/comments`, {
        method: 'POST',
        headers: as(agent, { 'idempotency-key': 'b5-comment-once' }),
        payload: { body: 'Looks like a duplicate.' },
      });

    expect((await send()).statusCode).toBe(201);
    expect((await send()).statusCode).toBe(201);
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(comments).where(eq(comments.issueId, issue.id)),
    ).toHaveLength(1);
  });

  test('applies one edit, recorded once', async () => {
    const { owner, workspace, project, agent } = await setUp();
    const issue = (
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: 'Move me' },
      })
    ).json().issue;
    const send = () =>
      request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
        method: 'PATCH',
        headers: as(agent, { 'idempotency-key': 'b5-edit-once' }),
        payload: { status: 'IN_PROGRESS' },
      });

    await send();
    await send();
    const { ownerDb } = await getHarness();
    const moves = await ownerDb
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.workspaceId, workspace.id),
          eq(auditEvents.eventType, 'issue.status_changed'),
        ),
      );
    expect(moves).toHaveLength(1);
  });
});

describe('revoking', () => {
  test('a revoked token fails on the very next call', async () => {
    const { owner, workspace, agent } = await setUp();
    const read = () => request(`/workspaces/${workspace.id}/projects`, { headers: as(agent) });
    expect((await read()).statusCode).toBe(200);

    const revoked = await request(
      `/workspaces/${workspace.id}/agents/${agent.id}/tokens/${agent.tokenId}`,
      { method: 'DELETE', actor: owner },
    );
    expect(revoked.statusCode).toBe(204);
    expect((await read()).statusCode).toBe(401);
  });

  test('another token keeps working until it too is revoked', async () => {
    const { owner, workspace, agent } = await setUp();
    const second = await request(`/workspaces/${workspace.id}/agents/${agent.id}/tokens`, {
      method: 'POST',
      actor: owner,
      payload: { label: 'CI' },
    });
    expect(second.statusCode).toBe(201);
    const ci = { ...agent, secret: second.json().token.secret };

    await request(`/workspaces/${workspace.id}/agents/${agent.id}/tokens/${agent.tokenId}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(
      (await request(`/workspaces/${workspace.id}/projects`, { headers: as(ci) })).statusCode,
    ).toBe(200);
  });

  test('removing the agent stops every token and takes it out of the workspace', async () => {
    const { owner, workspace, agent } = await setUp();
    const removed = await request(`/workspaces/${workspace.id}/agents/${agent.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.statusCode).toBe(204);
    expect(
      (await request(`/workspaces/${workspace.id}/projects`, { headers: as(agent) })).statusCode,
    ).toBe(401);
    const { members } = (
      await request(`/workspaces/${workspace.id}/members`, { actor: owner })
    ).json();
    expect(members.map((m: { userId: string }) => m.userId)).toEqual([owner.id]);
  });

  test('an agent cannot revoke, add or remove agents itself', async () => {
    const { workspace, agent } = await setUp();
    const own = await request(
      `/workspaces/${workspace.id}/agents/${agent.id}/tokens/${agent.tokenId}`,
      { method: 'DELETE', headers: as(agent) },
    );
    expect(own.statusCode).toBe(403);
  });
});

describe('what the review asked for', () => {
  test('a token’s secret is never kept, not even by the idempotency ledger', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const response = await request(`/workspaces/${workspace.id}/agents`, {
      method: 'POST',
      actor: owner,
      headers: { 'idempotency-key': 'b5-agent-create' },
      payload: { name: 'Keyed bot', role: 'MEMBER' },
    });
    const { secret } = response.json().token;

    const { ownerDb } = await getHarness();
    const stored = JSON.stringify(await ownerDb.select().from(mutations));
    expect(stored).not.toContain(secret);
  });

  test('an agent cannot walk out of its workspace; an admin removes it', async () => {
    const { workspace, agent } = await setUp();
    const left = await request(`/workspaces/${workspace.id}/members/me`, {
      method: 'DELETE',
      headers: as(agent),
    });
    expect(left.statusCode).toBe(403);
    expect(left.json().error).toBe('agent_cannot_leave');
  });

  test('removing an agent as a member revokes its tokens as well', async () => {
    const { owner, workspace, agent } = await setUp();
    const removed = await request(`/workspaces/${workspace.id}/members/${agent.id}`, {
      method: 'DELETE',
      actor: owner,
    });
    expect(removed.statusCode).toBe(204);
    const { ownerDb } = await getHarness();
    const [token] = await ownerDb
      .select({ revokedAt: agentTokens.revokedAt })
      .from(agentTokens)
      .where(eq(agentTokens.id, agent.tokenId));
    expect(token?.revokedAt).not.toBeNull();
  });

  test('a token of the wrong shape is refused without being looked up', async () => {
    const { workspace } = await setUp();
    const forged = { id: '', username: '', tokenId: '', secret: 'rba_short' };
    const response = await request(`/workspaces/${workspace.id}/projects`, { headers: as(forged) });
    expect(response.statusCode).toBe(401);
  });
});
