import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { attachments, jobs, processErasureRequests, users } from '@robis/database';
import { eq, sql } from 'drizzle-orm';
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
 * Deleting your own account (stage 1, item 10): confirmed with the
 * password, a clear choice for every workspace you alone own, your files
 * removed, and afterwards no table keeping your personal fields.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

function deleteAccount(actor: Actor, payload: unknown) {
  return request('/auth/me', { method: 'DELETE', actor, payload });
}

async function personalTrace(values: readonly string[]): Promise<string[]> {
  // Every text-like column of every table, searched for any of the values.
  const { ownerDb } = await getHarness();
  const columns = (await ownerDb.execute(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'jsonb', 'json')
      and table_name not like '%drizzle%'`)) as unknown as {
    table_name: string;
    column_name: string;
  }[];
  const found: string[] = [];
  for (const { table_name, column_name } of columns) {
    for (const value of values) {
      const rows = (await ownerDb.execute(
        sql`select count(*)::int as n from ${sql.identifier(table_name)}
            where ${sql.identifier(column_name)}::text ilike ${`%${value}%`}`,
      )) as unknown as { n: number }[];
      if (rows[0]!.n > 0) found.push(`${table_name}.${column_name} holds "${value}"`);
    }
  }
  return found;
}

describe('deleting your account', () => {
  test('asks for the password, and refuses a wrong one', async () => {
    const actor = await createActor('Leaving');
    expect((await deleteAccount(actor, {})).statusCode).toBe(400);
    const wrong = await deleteAccount(actor, { password: 'not the password', workspaces: [] });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe('password_incorrect');
    expect((await request('/auth/me', { actor })).statusCode).toBe(200);
  });

  test('needs a decision for every workspace you alone own', async () => {
    const actor = await createActor('Leaving');
    const workspace = await createWorkspace(actor, 'Mine');
    const response = await deleteAccount(actor, { password: ACTOR_PASSWORD, workspaces: [] });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'workspace_decision_needed',
      workspaces: [{ id: workspace.id, name: 'Mine' }],
    });
  });

  test('hands a workspace to a member, who becomes its owner', async () => {
    const actor = await createActor('Leaving');
    const heir = await createActor('Heir');
    const workspace = await createWorkspace(actor, 'Shared');
    await addMember(actor, workspace.id, heir, 'MEMBER');

    const stranger = await createActor('Stranger');
    const refused = await deleteAccount(actor, {
      password: ACTOR_PASSWORD,
      workspaces: [{ id: workspace.id, action: 'transfer', to: stranger.id }],
    });
    expect(refused.statusCode).toBe(400);

    const done = await deleteAccount(actor, {
      password: ACTOR_PASSWORD,
      workspaces: [{ id: workspace.id, action: 'transfer', to: heir.id }],
    });
    expect(done.statusCode).toBe(204);
    const mine = await request(`/workspaces/${workspace.id}`, { actor: heir });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().workspace.role).toBe('OWNER');
  });

  test('deletes a workspace you choose to, with its files', async () => {
    const actor = await createActor('Leaving');
    const workspace = await createWorkspace(actor, 'Doomed');
    const { db } = await getHarness();
    const project = await createProject(actor, workspace.id);
    const issue = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor,
      payload: { title: 'With a picture' },
    });
    await db.insert(attachments).values({
      workspaceId: workspace.id,
      issueId: issue.json().issue.id,
      storageKey: `test/${workspace.id}/file.png`,
      contentType: 'image/png',
      bytes: 10,
      width: 1,
      height: 1,
      uploaderId: actor.id,
    });

    const done = await deleteAccount(actor, {
      password: ACTOR_PASSWORD,
      workspaces: [{ id: workspace.id, action: 'delete' }],
    });
    expect(done.statusCode).toBe(204);
    const { ownerDb } = await getHarness();
    const left = await ownerDb.execute(sql`select 1 from workspaces where id = ${workspace.id}`);
    expect([...left]).toHaveLength(0);
    const purges = await ownerDb.select().from(jobs).where(eq(jobs.kind, 'storage.purge'));
    expect(JSON.stringify(purges)).toContain(`test/${workspace.id}/file.png`);
  });

  test('ends every session, and the account cannot sign in again', async () => {
    const actor = await createActor('Leaving');
    expect(
      (await deleteAccount(actor, { password: ACTOR_PASSWORD, workspaces: [] })).statusCode,
    ).toBe(204);
    expect((await request('/auth/me', { actor })).statusCode).toBe(401);
    const login = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: ACTOR_PASSWORD },
    });
    expect(login.statusCode).toBe(401);
  });

  test('keeps what you wrote in shared workspaces, under no name', async () => {
    const owner = await createActor('Owner');
    const actor = await createActor('Leaving');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, actor, 'MEMBER');
    const project = await createProject(owner, workspace.id);
    const issue = await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      method: 'POST',
      actor,
      payload: { title: 'Written before leaving' },
    });
    expect(issue.statusCode).toBe(201);

    await deleteAccount(actor, { password: ACTOR_PASSWORD, workspaces: [] });
    const { ownerDb } = await getHarness();
    const [row] = await ownerDb.select().from(users).where(eq(users.id, actor.id));
    expect(row!.name).toBe('Deleted user');
    expect(row!.deletedAt).not.toBeNull();
  });

  test('leaves no table keeping your personal fields, once the erasure has run', async () => {
    const owner = await createActor('Owner');
    const actor = await createActor('Zephyrine Quillfeather');
    const workspace = await createWorkspace(owner);
    await addMember(owner, workspace.id, actor, 'MEMBER');
    const { ownerDb, eraserDb } = await getHarness();
    const [before] = await ownerDb.select().from(users).where(eq(users.id, actor.id));

    expect(
      (await deleteAccount(actor, { password: ACTOR_PASSWORD, workspaces: [] })).statusCode,
    ).toBe(204);
    const processed = await processErasureRequests(eraserDb);
    expect(processed).toBe(1);

    expect(await personalTrace([before!.email, before!.name, before!.username])).toEqual([]);
  });
});
