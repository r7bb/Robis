import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { anniversaryIn, celebrationId } from '@robis/api/feed-celebrations';
import { issues, workspaceMembers } from '@robis/database';
import { and, eq } from 'drizzle-orm';
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
} from './harness.ts';

/**
 * Celebrations on the Feed (Phase 2c). Done when: a project finished, an
 * issue milestone, an anniversary and a welcome show for the last seven
 * days only; never for anyone who turned celebrations off, and that choice
 * is theirs alone to see; inside the workspace only.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

type Celebration = { id: string; kind: string; userId: string | null; count: number | null };

async function celebrationsFor(actor: Actor, workspaceId: string): Promise<Celebration[]> {
  const reply = await request(`/workspaces/${workspaceId}/feed/celebrations`, { actor });
  expect(reply.statusCode).toBe(200);
  return reply.json().celebrations;
}

async function fileDone(
  actor: Actor,
  workspaceId: string,
  projectId: string,
  n: number,
  fields = {},
) {
  for (let i = 0; i < n; i++) {
    const made = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
      method: 'POST',
      actor,
      payload: { title: `Piece ${i + 1}`, status: 'DONE', ...fields },
    });
    expect(made.statusCode).toBe(201);
  }
}

async function team() {
  const owner = await createActor('Owner');
  const member = await createActor('Member');
  const workspace = await createWorkspace(owner);
  await addMember(owner, workspace.id, member, 'MEMBER');
  return { owner, member, workspace };
}

const optOut = (actor: Actor, workspaceId: string) =>
  request(`/workspaces/${workspaceId}/people/me`, {
    method: 'PATCH',
    actor,
    payload: { celebrate: false },
  });

describe('what is celebrated', () => {
  test('a tenth issue done, a welcome, and a finished project; the maker of the workspace is not welcomed', async () => {
    const { owner, member, workspace } = await team();
    const project = await createProject(owner, workspace.id, 'Launch');
    await fileDone(owner, workspace.id, project.id, 10, { assigneeId: member.id });

    const kinds = (await celebrationsFor(owner, workspace.id)).map((c) => [
      c.kind,
      c.userId,
      c.count,
    ]);
    expect(kinds).toContainEqual(['issues_done', member.id, 10]);
    expect(kinds).toContainEqual(['joined', member.id, null]);
    expect(kinds).toContainEqual(['project_finished', null, 10]);
    expect(kinds).not.toContainEqual(['joined', owner.id, null]);
  });

  test('a project with only two issues done, or one finished long ago, is not', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const small = await createProject(owner, workspace.id, 'Small');
    const old = await createProject(owner, workspace.id, 'Old');
    await fileDone(owner, workspace.id, small.id, 2);
    await fileDone(owner, workspace.id, old.id, 3);
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(issues)
      .set({ completedAt: daysAgo(20) })
      .where(eq(issues.projectId, old.id));
    expect(await celebrationsFor(owner, workspace.id)).toEqual([]);
  });

  test('a milestone reached more than seven days ago is not news', async () => {
    const { owner, member, workspace } = await team();
    const project = await createProject(owner, workspace.id);
    await fileDone(owner, workspace.id, project.id, 10, { assigneeId: member.id });
    await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Still open' },
    });
    const { ownerDb } = await getHarness();
    await ownerDb
      .update(issues)
      .set({ completedAt: daysAgo(9) })
      .where(eq(issues.projectId, project.id));
    const kinds = (await celebrationsFor(owner, workspace.id)).map((c) => c.kind);
    expect(kinds).not.toContain('issues_done');
  });

  test('a year with the team, in the week it falls', async () => {
    const { owner, member, workspace } = await team();
    const { ownerDb } = await getHarness();
    const joined = new Date(Date.now() - 365 * DAY - 2 * DAY);
    await ownerDb
      .update(workspaceMembers)
      .set({ createdAt: joined })
      .where(
        and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, member.id)),
      );
    const found = await celebrationsFor(owner, workspace.id);
    expect(found).toContainEqual(
      expect.objectContaining({
        id: celebrationId('anniversary', member.id, 1),
        kind: 'anniversary',
        userId: member.id,
        count: 1,
      }),
    );
    expect(found.map((c) => c.kind)).not.toContain('joined');
  });
});

describe('a personal opt-out', () => {
  test('off, and nothing celebrates them; their choice shows to them alone', async () => {
    const { owner, member, workspace } = await team();
    const project = await createProject(owner, workspace.id);
    await fileDone(owner, workspace.id, project.id, 10, { assigneeId: member.id });
    expect((await optOut(member, workspace.id)).statusCode).toBe(200);

    const found = await celebrationsFor(owner, workspace.id);
    expect(found.filter((c) => c.userId === member.id)).toEqual([]);
    // The project is the team's, not theirs: it is still celebrated.
    expect(found.map((c) => c.kind)).toContain('project_finished');

    const own = await request(`/workspaces/${workspace.id}/people/${member.id}`, { actor: member });
    const seen = await request(`/workspaces/${workspace.id}/people/${member.id}`, { actor: owner });
    expect(own.json().profile.celebrate).toBe(false);
    expect(seen.json().profile.celebrate).toBeNull();
  });
});

describe('who may see them', () => {
  test('a stranger gets 404', async () => {
    const { workspace } = await team();
    const stranger = await createActor('Stranger');
    const reply = await request(`/workspaces/${workspace.id}/feed/celebrations`, {
      actor: stranger,
    });
    expect(reply.statusCode).toBe(404);
  });
});

describe('anniversaries, on their own', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const since = new Date(now.getTime() - 7 * DAY);

  test('in the window, with the years it marks; never on the first day', () => {
    expect(anniversaryIn(new Date('2024-11-18T09:00:00Z'), since, now)).toEqual({
      years: 2,
      at: new Date('2026-11-18T09:00:00Z'),
    });
    expect(anniversaryIn(new Date('2026-11-18T09:00:00Z'), since, now)).toBeNull();
    expect(anniversaryIn(new Date('2025-11-01T09:00:00Z'), since, now)).toBeNull();
  });

  test('a window across new year finds last year’s date', () => {
    const jan = new Date('2027-01-03T12:00:00Z');
    expect(
      anniversaryIn(new Date('2025-12-30T08:00:00Z'), new Date(jan.getTime() - 7 * DAY), jan),
    ).toEqual({
      years: 1,
      at: new Date('2026-12-30T08:00:00Z'),
    });
  });
});

describe('reacting to a celebration', () => {
  test('a reaction shows who gave it, once however often it is given, and can be taken back', async () => {
    const { owner, member, workspace } = await team();
    const [welcome] = await celebrationsFor(owner, workspace.id);
    expect(welcome?.kind).toBe('joined');
    const path = `/workspaces/${workspace.id}/feed/celebrations/${encodeURIComponent(welcome!.id)}/reactions`;

    for (let i = 0; i < 2; i++) {
      expect((await request(`${path}/celebrate`, { method: 'PUT', actor: owner })).statusCode).toBe(
        204,
      );
    }
    expect((await request(`${path}/thanks`, { method: 'PUT', actor: member })).statusCode).toBe(
      204,
    );
    const [seen] = (
      await request(`/workspaces/${workspace.id}/feed/celebrations`, { actor: member })
    ).json().celebrations;
    expect(seen.reactions.celebrate).toEqual([owner.id]);
    expect(seen.reactions.thanks).toEqual([member.id]);

    expect(
      (await request(`${path}/celebrate`, { method: 'DELETE', actor: owner })).statusCode,
    ).toBe(204);
    const [after] = (
      await request(`/workspaces/${workspace.id}/feed/celebrations`, { actor: owner })
    ).json().celebrations;
    expect(after.reactions.celebrate).toEqual([]);
  });

  test('only a celebration on the list takes one, and only from inside the workspace', async () => {
    const { owner, member, workspace } = await team();
    const made = celebrationId('joined', owner.id);
    const invented = await request(
      `/workspaces/${workspace.id}/feed/celebrations/${encodeURIComponent(made)}/reactions/celebrate`,
      { method: 'PUT', actor: owner },
    );
    expect(invented.statusCode).toBe(404);

    const [welcome] = await celebrationsFor(owner, workspace.id);
    const stranger = await createActor('Stranger');
    const outside = await request(
      `/workspaces/${workspace.id}/feed/celebrations/${encodeURIComponent(welcome!.id)}/reactions/celebrate`,
      { method: 'PUT', actor: stranger },
    );
    expect(outside.statusCode).toBe(404);
    const unknown = await request(
      `/workspaces/${workspace.id}/feed/celebrations/${encodeURIComponent(welcome!.id)}/reactions/love`,
      { method: 'PUT', actor: member },
    );
    expect(unknown.statusCode).toBe(400);
  });
});
