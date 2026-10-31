import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  addMember,
  closeHarness,
  createActor,
  createWorkspace,
  recordQueries,
  request,
  resetDatabase,
} from './harness.ts';

/**
 * On a workspace route the session and the caller's membership of that
 * workspace come from one query (stage 3, item 28), not one each: every
 * workspace request used to pay a second round trip before doing anything.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const touches = (sql: string, table: string) => sql.includes(`"${table}"`);

describe('session and membership', () => {
  test('a member reading a workspace costs one query for both', async () => {
    const actor = await createActor('Member');
    const workspace = await createWorkspace(actor);

    const stop = recordQueries();
    const response = await request(`/workspaces/${workspace.id}`, { actor });
    const statements = stop();

    expect(response.statusCode).toBe(200);
    const session = statements.filter((sql) => touches(sql, 'sessions'));
    expect(session).toHaveLength(1);
    expect(touches(session[0]!, 'workspace_members')).toBe(true);
    // No second lookup of the membership on its own.
    expect(
      statements.filter((sql) => touches(sql, 'workspace_members') && !touches(sql, 'sessions')),
    ).toEqual([]);
  });

  test('a stranger is still refused with not found, from the same one query', async () => {
    const owner = await createActor('Owner');
    const stranger = await createActor('Stranger');
    const workspace = await createWorkspace(owner);

    const stop = recordQueries();
    const response = await request(`/workspaces/${workspace.id}`, { actor: stranger });
    const statements = stop();

    expect(response.statusCode).toBe(404);
    expect(statements.filter((sql) => touches(sql, 'workspace_members'))).toHaveLength(1);
  });

  test('a route with no workspace still resolves the session alone', async () => {
    const actor = await createActor('Anyone');

    const stop = recordQueries();
    const response = await request('/workspaces', { actor });
    const statements = stop();

    expect(response.statusCode).toBe(200);
    const session = statements.filter((sql) => touches(sql, 'sessions'));
    expect(session).toHaveLength(1);
    expect(touches(session[0]!, 'workspace_members')).toBe(false);
  });

  test('the access rules hold: forbidden for a member without the right, not found otherwise', async () => {
    const owner = await createActor('Owner');
    const guest = await createActor('Guest');
    const elsewhere = await createActor('Elsewhere');
    const mine = await createWorkspace(owner, 'Mine');
    const theirs = await createWorkspace(elsewhere, 'Theirs');
    await addMember(owner, mine.id, guest, 'GUEST');

    // A guest is a member, so knows the workspace exists: forbidden, not hidden.
    const rename = await request(`/workspaces/${mine.id}`, {
      method: 'PATCH',
      actor: guest,
      payload: { name: 'Renamed' },
    });
    expect(rename.statusCode).toBe(403);

    // A member of one workspace learns nothing of another.
    const other = await request(`/workspaces/${theirs.id}`, { actor: owner });
    expect(other.statusCode).toBe(404);

    // A malformed id is the same not found, never a database error.
    const malformed = await request('/workspaces/not-a-workspace', { actor: owner });
    expect(malformed.statusCode).toBe(404);
  });
});
