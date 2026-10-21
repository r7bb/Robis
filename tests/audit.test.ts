import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  type AuditRow,
  advanceStreamCursor,
  auditEvents,
  auditHash,
  auditKeyringFromEnv,
  configureAuditKeys,
  DEVELOPMENT_KEY_ID,
  eraseAuditPersonalData,
  recordAudit,
  sealLegacyChains,
  verifyAuditChain,
} from '@robis/database';
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

beforeEach(resetDatabase);
afterAll(closeHarness);

async function trail(workspaceId: string) {
  const { db } = await getHarness();
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.workspaceId, workspaceId))
    .orderBy(auditEvents.seq);
}

async function send(
  actor: Actor,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  const response = await request(url, { method, actor, payload });
  if (response.statusCode >= 300) {
    throw new Error(`${method} ${url}: ${response.statusCode} ${response.body}`);
  }
  return response.statusCode === 204 ? null : response.json();
}

/**
 * Change rows behind the application's back, the way someone with the
 * table owner's rights could. The trigger that refuses edits is switched off
 * for the one transaction, which is exactly what it cannot prevent.
 */
async function tamper(statement: ReturnType<typeof sql>) {
  const { ownerDb } = await getHarness();
  await ownerDb.transaction(async (tx) => {
    await tx.execute(sql`alter table audit_events disable trigger audit_events_append_only`);
    await tx.execute(statement);
    await tx.execute(sql`alter table audit_events enable trigger audit_events_append_only`);
  });
}

/** A workspace with `count` issues, so there is a chain worth breaking. */
async function workspaceWithEvents(count: number) {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);

  for (let n = 0; n < count; n++) {
    await send(owner, 'POST', `/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      title: `Issue ${n}`,
    });
  }

  return { owner, workspace, project };
}

describe('every change leaves an event', () => {
  test('each kind of workspace change is recorded once, in order, by a human actor', async () => {
    const owner = await createActor('Owner');
    const other = await createActor('Other');
    const leaver = await createActor('Leaver');
    const ws = await createWorkspace(owner);
    const base = `/workspaces/${ws.id}`;

    const project = await createProject(owner, ws.id);
    const { issue } = await send(owner, 'POST', `${base}/projects/${project.id}/issues`, {
      title: 'Login fails',
    });
    await send(owner, 'PATCH', `${base}/issues/${issue.id}`, { status: 'IN_PROGRESS' });
    await send(owner, 'PATCH', `${base}/issues/${issue.id}`, { title: 'Login fails on Safari' });

    const { comment } = await send(owner, 'POST', `${base}/issues/${issue.id}/comments`, {
      body: 'Seen it too',
    });
    await send(owner, 'DELETE', `${base}/comments/${comment.id}`);

    const { document } = await send(owner, 'POST', `${base}/documents`, { title: 'Spec' });
    await send(owner, 'PATCH', `${base}/documents/${document.id}`, { title: 'Spec v2' });
    await send(owner, 'DELETE', `${base}/documents/${document.id}`);

    const { channel } = await send(owner, 'POST', `${base}/channels`, { name: 'standup' });
    await send(owner, 'PATCH', `${base}/channels/${channel.id}`, { topic: 'Daily' });
    const { message } = await send(owner, 'POST', `${base}/channels/${channel.id}/messages`, {
      body: 'Morning',
    });
    await send(owner, 'DELETE', `${base}/messages/${message.id}`);
    await send(owner, 'DELETE', `${base}/channels/${channel.id}`);

    const startsAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    const { meeting } = await send(owner, 'POST', `${base}/meetings`, {
      title: 'Planning',
      startsAt,
    });
    const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
    await send(owner, 'PATCH', `${base}/meetings/${meeting.id}`, { startsAt: later });
    await send(owner, 'POST', `${base}/meetings/${meeting.id}/response`, { response: 'maybe' });
    await send(owner, 'DELETE', `${base}/meetings/${meeting.id}`);

    await addMember(owner, ws.id, other, 'MEMBER');
    await send(owner, 'PATCH', `${base}/members/${other.id}`, { role: 'ADMIN' });
    await send(owner, 'DELETE', `${base}/members/${other.id}`);
    await addMember(owner, ws.id, leaver, 'GUEST');
    await send(leaver, 'DELETE', `${base}/members/me`);

    await send(owner, 'PATCH', `${base}/projects/${project.id}`, { name: 'Web' });
    await send(owner, 'DELETE', `${base}/issues/${issue.id}`);
    await send(owner, 'DELETE', `${base}/projects/${project.id}`);
    await send(owner, 'PATCH', base, { name: 'Engineering 2' });

    const events = await trail(ws.id);

    expect(events.map((event) => event.eventType)).toEqual([
      'workspace.created',
      'project.created',
      'issue.created',
      'issue.status_changed',
      'issue.updated',
      'comment.created',
      'comment.deleted',
      'document.created',
      'document.updated',
      'document.deleted',
      'channel.created',
      'channel.updated',
      'message.deleted',
      'channel.deleted',
      'meeting.created',
      'meeting.updated',
      'meeting.responded',
      'meeting.canceled',
      'member.invited',
      'member.joined',
      'member.role_changed',
      'member.removed',
      'member.invited',
      'member.joined',
      'member.left',
      'project.updated',
      'issue.deleted',
      'project.deleted',
      'workspace.updated',
    ]);

    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect(events.every((event) => event.actorKind === 'human')).toBe(true);
    expect(events.every((event) => event.requestId)).toBe(true);
    expect(events.find((e) => e.eventType === 'member.left')?.actorId).toBe(leaver.id);

    const report = await verifyAuditChain((await getHarness()).db, ws.id);
    expect(report).toMatchObject({ ok: true, checked: events.length, broken: null });
    expect(report.head?.seq).toBe(events.length);
  });

  test('content stays out of the trail: a comment event names the issue, not the words', async () => {
    const owner = await createActor('Owner');
    const ws = await createWorkspace(owner);
    const project = await createProject(owner, ws.id);
    const { issue } = await send(
      owner,
      'POST',
      `/workspaces/${ws.id}/projects/${project.id}/issues`,
      { title: 'Crash' },
    );
    await send(owner, 'POST', `/workspaces/${ws.id}/issues/${issue.id}/comments`, {
      body: 'my private reasoning',
    });

    const comment = (await trail(ws.id)).find((e) => e.eventType === 'comment.created');
    expect(comment?.payload).not.toContain('private reasoning');
    expect(JSON.parse(comment!.payload)).toMatchObject({ issueId: issue.id });
  });

  test('the request id from the caller is stored with the event it caused', async () => {
    const owner = await createActor('Owner');
    const ws = await createWorkspace(owner);

    await request(`/workspaces/${ws.id}/projects`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Traced' },
      headers: { 'x-request-id': 'trace-me-0001' },
    });

    const created = (await trail(ws.id)).find((e) => e.eventType === 'project.created');
    expect(created?.requestId).toBe('trace-me-0001');
  });

  test('a refused change records nothing', async () => {
    const owner = await createActor('Owner');
    const ws = await createWorkspace(owner);
    await createProject(owner, ws.id, 'Web App');

    const clash = await request(`/workspaces/${ws.id}/projects`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'Again', key: 'WA' },
    });

    expect(clash.statusCode).toBe(409);
    expect((await trail(ws.id)).map((e) => e.eventType)).toEqual([
      'workspace.created',
      'project.created',
    ]);
  });
});

describe('transactions', () => {
  test('a rolled-back change leaves no event, and the next one takes its number', async () => {
    const { db } = await getHarness();
    const owner = await createActor('Owner');
    const ws = await createWorkspace(owner);

    const attempt = db.transaction(async (tx) => {
      await recordAudit(
        tx,
        { id: owner.id, kind: 'human' },
        {
          workspaceId: ws.id,
          entityType: 'workspace',
          entityId: ws.id,
          eventType: 'workspace.updated',
        },
      );
      throw new Error('the change itself failed');
    });

    await expect(attempt).rejects.toThrow('the change itself failed');
    expect(await trail(ws.id)).toHaveLength(1);

    await createProject(owner, ws.id);
    const events = await trail(ws.id);

    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect((await verifyAuditChain(db, ws.id)).ok).toBe(true);
  });

  test('concurrent writers in one workspace still produce one unbroken chain', async () => {
    const { db } = await getHarness();
    const { owner, workspace, project } = await workspaceWithEvents(0);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
          method: 'POST',
          actor: owner,
          payload: { title: `Parallel ${n}` },
        }),
      ),
    );

    expect(results.every((response) => response.statusCode === 201)).toBe(true);

    const events = await trail(workspace.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, index) => index + 1));
    expect(await verifyAuditChain(db, workspace.id)).toMatchObject({ ok: true, checked: 22 });
  });

  test('two people deleting the same issue at once record one deletion', async () => {
    const { owner, workspace, project } = await workspaceWithEvents(0);
    const { issue } = await send(
      owner,
      'POST',
      `/workspaces/${workspace.id}/projects/${project.id}/issues`,
      { title: 'Delete me twice' },
    );

    const results = await Promise.all(
      [1, 2].map(() =>
        request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
          method: 'DELETE',
          actor: owner,
        }),
      ),
    );

    expect(results.map((r) => r.statusCode).sort()).toEqual([204, 404]);
    const deletions = (await trail(workspace.id)).filter((e) => e.eventType === 'issue.deleted');
    expect(deletions).toHaveLength(1);
  });

  test('a status move records the status it really left, even when two race', async () => {
    const { owner, workspace, project } = await workspaceWithEvents(0);
    const { issue } = await send(
      owner,
      'POST',
      `/workspaces/${workspace.id}/projects/${project.id}/issues`,
      { title: 'Contended' },
    );

    await Promise.all(
      ['IN_PROGRESS', 'DONE'].map((status) =>
        request(`/workspaces/${workspace.id}/issues/${issue.id}`, {
          method: 'PATCH',
          actor: owner,
          payload: { status },
        }),
      ),
    );

    const moves = (await trail(workspace.id))
      .filter((e) => e.eventType === 'issue.status_changed')
      .map((e) => JSON.parse(e.payload) as { from: string; to: string });

    // Whichever ran second started from where the first one left it.
    expect(moves).toHaveLength(2);
    expect(moves[1]!.from).toBe(moves[0]!.to);
  });

  test('chains are per workspace', async () => {
    const owner = await createActor('Owner');
    const first = await createWorkspace(owner, 'First');
    const second = await createWorkspace(owner, 'Second');

    expect((await trail(first.id)).map((e) => e.seq)).toEqual([1]);
    expect((await trail(second.id)).map((e) => e.seq)).toEqual([1]);
    expect((await trail(second.id))[0]?.prevHash).toBeNull();
  });
});

describe('tampering', () => {
  test('an edited event is named, with the reason', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    await tamper(
      sql`update audit_events set payload = '{"title":"nothing to see"}'
          where workspace_id = ${workspace.id} and seq = 4`,
    );

    const report = await verifyAuditChain(db, workspace.id);

    expect(report.ok).toBe(false);
    expect(report.broken).toMatchObject({ seq: 4, reason: 'altered' });
    expect(report.checked).toBe(3);
  });

  test('a deleted event is named as missing', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    await tamper(sql`delete from audit_events where workspace_id = ${workspace.id} and seq = 3`);

    const report = await verifyAuditChain(db, workspace.id);
    expect(report.broken).toMatchObject({ seq: 3, reason: 'missing', eventId: null });
  });

  test('an event re-signed with the key is still caught at the next link', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    // Even someone holding the key, who re-signs the row they changed, leaves
    // the next row pointing at the old hash.
    const [row] = (await trail(workspace.id)).filter((event) => event.seq === 3);
    const forged = auditHash({ ...row!, payload: '{"forged":true}' });
    await tamper(sql`
      update audit_events set payload = '{"forged":true}', hash = ${forged}
      where workspace_id = ${workspace.id} and seq = 3
    `);

    const report = await verifyAuditChain(db, workspace.id);
    expect(report.broken).toMatchObject({ seq: 4, reason: 'relinked' });
  });

  test('the trigger refuses edits and deletes, even from the owner', async () => {
    const { ownerDb } = await getHarness();
    const { workspace } = await workspaceWithEvents(1);

    // Drizzle builders are lazy thenables; `rejects` needs a real promise.
    const run = async (statement: ReturnType<typeof sql>) => ownerDb.execute(statement);

    await expect(
      run(sql`update audit_events set payload = '{}' where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/append-only/);
    await expect(
      run(sql`delete from audit_events where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/append-only/);
  });

  /**
   * The trigger is the owner's to switch off. The role the application
   * connects as has no right to edit, delete or empty the table in the first
   * place, so even with the trigger off it is refused, and it cannot switch
   * the trigger off itself.
   */
  test('the runtime role cannot remove or change a row, even with the trigger off', async () => {
    const { db, ownerDb } = await getHarness();
    const { workspace } = await workspaceWithEvents(1);
    const before = (await trail(workspace.id)).length;
    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    await expect(
      run(sql`alter table audit_events disable trigger audit_events_append_only`),
    ).rejects.toThrow(/must be owner/);

    await ownerDb.execute(sql`alter table audit_events disable trigger audit_events_append_only`);
    try {
      await expect(
        run(sql`update audit_events set payload = '{}' where workspace_id = ${workspace.id}`),
      ).rejects.toThrow(/permission denied/);
      await expect(
        run(sql`delete from audit_events where workspace_id = ${workspace.id}`),
      ).rejects.toThrow(/permission denied/);
      await expect(run(sql`truncate audit_events`)).rejects.toThrow(/permission denied/);
    } finally {
      await ownerDb.execute(sql`alter table audit_events enable trigger audit_events_append_only`);
    }

    expect(await trail(workspace.id)).toHaveLength(before);
  });

  test('deleting the workspace still takes its trail with it', async () => {
    const { owner, workspace } = await workspaceWithEvents(2);

    const deleted = await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
      payload: { password: ACTOR_PASSWORD },
    });

    expect(deleted.statusCode).toBe(204);
    expect(await trail(workspace.id)).toHaveLength(0);
  });

  test('a row edited into something unhashable is reported, not a crash', async () => {
    const { db } = await getHarness();
    const { owner, workspace } = await workspaceWithEvents(2);

    // Not JSON, and containing the field separator: the worst a hand edit can do.
    await tamper(
      sql`update audit_events set payload = ${'not json \x1f at all'}
          where workspace_id = ${workspace.id} and seq = 2`,
    );

    expect((await verifyAuditChain(db, workspace.id)).broken).toMatchObject({
      seq: 2,
      reason: 'altered',
    });

    // The export still serves the page, raw text and all.
    const page = await request(`/workspaces/${workspace.id}/audit/events?after=0`, {
      actor: owner,
    });
    expect(page.statusCode).toBe(200);
    expect(page.json().events[1].payload).toBe('not json \x1f at all');
  });

  test('dropping the newest events is caught against what the stream already received', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(3);

    // The receiver acknowledged all five.
    await advanceStreamCursor(db, workspace.id, 5);
    await tamper(sql`delete from audit_events where workspace_id = ${workspace.id} and seq >= 4`);

    const report = await verifyAuditChain(db, workspace.id);
    expect(report.ok).toBe(false);
    expect(report.broken).toMatchObject({ seq: 4, reason: 'truncated' });
    expect(report.head?.seq).toBe(3);
  });

  test('the trail cannot be truncated, directly or by cascade', async () => {
    const { db, ownerDb } = await getHarness();
    await workspaceWithEvents(1);

    // The owner is stopped by the trigger...
    const asOwner = async (statement: ReturnType<typeof sql>) => ownerDb.execute(statement);
    await expect(asOwner(sql`truncate audit_events`)).rejects.toThrow(/cannot be truncated/);
    await expect(asOwner(sql`truncate workspaces cascade`)).rejects.toThrow(/cannot be truncated/);

    // ...and the runtime role holds no TRUNCATE right on any table at all.
    const asApp = async (statement: ReturnType<typeof sql>) => db.execute(statement);
    await expect(asApp(sql`truncate workspaces cascade`)).rejects.toThrow(/permission denied/);
  });

  test('the SQL copy of the unsigned hash agrees with the application, unicode and all', async () => {
    const { db } = await getHarness();
    const owner = await createActor('Owner');
    const ws = await createWorkspace(owner, 'Café ☕ 𝄞');

    // The SQL function is the unsigned form, which built the first chains.
    const [row] = await trail(ws.id);
    const rows = await db.execute<{ recomputed: string }>(sql`
      select robis_audit_hash(prev_hash, workspace_id, seq, actor_id, actor_kind::text,
        request_id, entity_type, entity_id, event_type, payload, created_at) as recomputed
      from audit_events where workspace_id = ${ws.id}
    `);

    expect(rows.length).toBe(1);
    expect(rows[0]?.recomputed).toBe(auditHash({ ...row!, keyId: null }));
  });
});

/**
 * Rewrite a chain from `fromSeq` to its end, consistently, the way someone
 * with database access but no key would: every hash recomputed unsigned,
 * every link updated. Each row checks out against the one before it.
 */
async function rewriteWithoutKey(workspaceId: string, fromSeq: number) {
  const rows = await trail(workspaceId);
  let prevHash = rows.find((row) => row.seq === fromSeq - 1)?.hash ?? null;

  for (const row of rows.filter((event) => event.seq >= fromSeq)) {
    const forged: AuditRow = { ...row, payload: '{"forged":true}', prevHash, keyId: null };
    const hash = auditHash(forged);
    await tamper(sql`
      update audit_events
      set payload = ${forged.payload}, prev_hash = ${prevHash}, key_id = null, hash = ${hash}
      where id = ${row.id}
    `);
    prevHash = hash;
  }
}

describe('signing', () => {
  test('new events are signed with the current key', async () => {
    const { workspace } = await workspaceWithEvents(1);
    for (const row of await trail(workspace.id)) expect(row.keyId).toBe(DEVELOPMENT_KEY_ID);
  });

  test('a row re-hashed without the key is caught where it was changed', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    // Keeps the key id, but cannot produce that key's signature.
    const [row] = (await trail(workspace.id)).filter((event) => event.seq === 3);
    const unsigned = auditHash({ ...row!, payload: '{"forged":true}', keyId: null });
    await tamper(sql`
      update audit_events set payload = '{"forged":true}', hash = ${unsigned}
      where workspace_id = ${workspace.id} and seq = 3
    `);

    expect((await verifyAuditChain(db, workspace.id)).broken).toMatchObject({
      seq: 3,
      reason: 'altered',
    });
  });

  test('rewriting the tail of a chain unsigned is caught as a downgrade', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    await rewriteWithoutKey(workspace.id, 3);

    expect((await verifyAuditChain(db, workspace.id)).broken).toMatchObject({
      seq: 3,
      reason: 'downgraded',
    });
  });

  test('rewriting a whole chain unsigned is caught: every chain carries a signature', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    await rewriteWithoutKey(workspace.id, 1);

    expect((await verifyAuditChain(db, workspace.id)).broken).toMatchObject({
      reason: 'unsigned',
    });
  });

  test('a chain from before signing verifies once it is sealed', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(3);
    // Stand-in for a trail written before signing existed.
    await rewriteWithoutKey(workspace.id, 1);
    expect((await verifyAuditChain(db, workspace.id)).ok).toBe(false);

    expect(await sealLegacyChains(db)).toEqual([{ workspaceId: workspace.id, outcome: 'sealed' }]);
    const events = await trail(workspace.id);
    expect(events.at(-1)).toMatchObject({ eventType: 'audit.keyed', keyId: DEVELOPMENT_KEY_ID });

    expect(await verifyAuditChain(db, workspace.id)).toMatchObject({ ok: true, checked: 6 });
    // Sealing again finds nothing to do.
    expect(await sealLegacyChains(db)).toEqual([]);
  });

  test('sealing refuses a chain that was signed and then rewritten', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);
    await rewriteWithoutKey(workspace.id, 3);

    const [outcome] = await sealLegacyChains(db);
    expect(outcome).toMatchObject({ workspaceId: workspace.id, outcome: 'skipped' });
    expect((await trail(workspace.id)).at(-1)?.eventType).not.toBe('audit.keyed');
    expect((await verifyAuditChain(db, workspace.id)).broken?.reason).toBe('downgraded');
  });

  test('an empty key id is neither signed nor unsigned: the database refuses it', async () => {
    const { workspace } = await workspaceWithEvents(1);
    const run = async () =>
      tamper(sql`update audit_events set key_id = '' where workspace_id = ${workspace.id}`);
    await expect(run()).rejects.toThrow(/audit_events_key_id_format/);
  });

  test('a key id that could never be issued reads as an edit, not a missing key', async () => {
    const { db, ownerDb } = await getHarness();
    const { workspace } = await workspaceWithEvents(2);
    // With the constraint dropped as well, the way an owner could.
    await ownerDb
      .transaction(async (tx) => {
        await tx.execute(sql`alter table audit_events drop constraint audit_events_key_id_format`);
        await tx.execute(sql`alter table audit_events disable trigger audit_events_append_only`);
        await tx.execute(
          sql`update audit_events set key_id = '' where workspace_id = ${workspace.id} and seq = 2`,
        );
        const report = await verifyAuditChain(tx, workspace.id);
        expect(report.broken).toMatchObject({ seq: 2, reason: 'altered' });
        // Undone with the transaction, constraint and all.
        await tx.execute(sql`select 1/0`);
      })
      .catch((error: Error) => {
        if (!/division by zero/.test(error.message)) throw error;
      });
    expect((await verifyAuditChain(db, workspace.id)).ok).toBe(true);
  });
});

describe('what the runtime role holds', () => {
  const privilege = async (object: string, kind: 'table' | 'sequence', right: string) => {
    const { db } = await getHarness();
    const check =
      kind === 'table'
        ? sql`select has_table_privilege(current_user, ${object}, ${right}) as allowed`
        : sql`select has_sequence_privilege(current_user, ${object}, ${right}) as allowed`;
    const [row] = (await db.execute(check)) as unknown as { allowed: boolean }[];
    return row!.allowed;
  };

  test('audit events: read and append only', async () => {
    expect(await privilege('audit_events', 'table', 'SELECT')).toBe(true);
    expect(await privilege('audit_events', 'table', 'INSERT')).toBe(true);
    expect(await privilege('audit_events', 'table', 'UPDATE')).toBe(false);
    expect(await privilege('audit_events', 'table', 'DELETE')).toBe(false);
    expect(await privilege('audit_events', 'table', 'TRUNCATE')).toBe(false);
  });

  test('tombstones: read only', async () => {
    expect(await privilege('audit_tombstones', 'table', 'SELECT')).toBe(true);
    expect(await privilege('audit_tombstones', 'table', 'INSERT')).toBe(false);
  });

  test('no table can be emptied, and no sequence reset', async () => {
    expect(await privilege('workspaces', 'table', 'TRUNCATE')).toBe(false);
    const { db } = await getHarness();
    const sequences = (await db.execute(
      sql`select sequencename as name from pg_sequences where schemaname = 'public'`,
    )) as unknown as { name: string }[];
    for (const { name } of sequences) {
      expect(await privilege(name, 'sequence', 'UPDATE')).toBe(false);
    }
  });
});

describe('deleting a workspace leaves a trace', () => {
  test('the trail goes with it, but a tombstone records its length and last hash', async () => {
    const { db } = await getHarness();
    const { owner, workspace } = await workspaceWithEvents(2);
    const last = (await trail(workspace.id)).at(-1)!;

    await send(owner, 'DELETE', `/workspaces/${workspace.id}`, { password: ACTOR_PASSWORD });

    const tombstones = (await db.execute(
      sql`select head_seq, head_hash, deleted_by from audit_tombstones where workspace_id = ${workspace.id}`,
    )) as unknown as { head_seq: string; head_hash: string; deleted_by: string }[];
    expect(tombstones).toEqual([
      { head_seq: String(last.seq), head_hash: last.hash, deleted_by: 'robis_app' },
    ]);
  });

  test('the runtime role cannot write, change or remove a tombstone', async () => {
    const { db } = await getHarness();
    const { owner, workspace } = await workspaceWithEvents(1);
    await send(owner, 'DELETE', `/workspaces/${workspace.id}`, { password: ACTOR_PASSWORD });
    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    await expect(
      run(sql`insert into audit_tombstones (workspace_id, head_seq, deleted_by)
              values (${workspace.id}, 0, 'forged')`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      run(sql`update audit_tombstones set head_seq = 0 where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the stream cursor', () => {
  test('moves forward only, and never past the newest event', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(2);
    await advanceStreamCursor(db, workspace.id, 3);
    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    await expect(
      run(
        sql`update audit_stream_cursors set delivered_seq = 1 where workspace_id = ${workspace.id}`,
      ),
    ).rejects.toThrow(/only move forward/);
    await expect(
      run(
        sql`update audit_stream_cursors set delivered_seq = 999 where workspace_id = ${workspace.id}`,
      ),
    ).rejects.toThrow(/cannot pass the newest event/);
    await expect(
      run(sql`delete from audit_stream_cursors where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/go only with their workspace/);
  });
});

describe('signing keys', () => {
  const devKeyring = auditKeyringFromEnv({ NODE_ENV: 'test' });
  const secret = (fill: string) => Buffer.alloc(32, fill).toString('base64');
  const random = () => crypto.getRandomValues(new Uint8Array(32));
  const realSecret = () => Buffer.from(random()).toString('base64');
  const [KEY_A, KEY_B, KEY_C, KEY_D, KEY_E] = Array.from({ length: 5 }, realSecret);

  test('a secret must be real base64 of random bytes', () => {
    const parse = (keys: string) => () =>
      auditKeyringFromEnv({ NODE_ENV: 'test', AUDIT_HMAC_KEYS: keys });
    // Characters Node would silently skip.
    expect(parse(`k1:${realSecret()}!!`)).toThrow(/not valid base64/);
    // Thirty-two copies of one byte.
    expect(parse(`k1:${secret('a')}`)).toThrow(/one byte repeated/);
    expect(parse(`k1:${realSecret()}`)().currentId).toBe('k1');
  });

  test('the committed stack key is refused in production, like the development one', () => {
    expect(() =>
      auditKeyringFromEnv({ NODE_ENV: 'production', AUDIT_HMAC_KEYS: `stack:${realSecret()}` }),
    ).toThrow(/development only/);
  });

  test('a rotated key keeps old events verifiable', async () => {
    const { db } = await getHarness();
    try {
      configureAuditKeys(auditKeyringFromEnv({ NODE_ENV: 'test', AUDIT_HMAC_KEYS: `k1:${KEY_A}` }));
      const { workspace, owner, project } = await workspaceWithEvents(2);

      configureAuditKeys(
        auditKeyringFromEnv({
          NODE_ENV: 'test',
          AUDIT_HMAC_KEYS: `k2:${KEY_B},k1:${KEY_A}`,
        }),
      );
      await send(owner, 'POST', `/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        title: 'After the rotation',
      });

      const keys = (await trail(workspace.id)).map((row) => row.keyId);
      expect(keys).toEqual(['k1', 'k1', 'k1', 'k1', 'k2']);
      expect((await verifyAuditChain(db, workspace.id)).ok).toBe(true);
    } finally {
      configureAuditKeys(devKeyring);
    }
  });

  test('an event signed with a key this server lacks is reported, not crashed on', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(1);
    try {
      configureAuditKeys(
        auditKeyringFromEnv({ NODE_ENV: 'test', AUDIT_HMAC_KEYS: `other:${KEY_C}` }),
      );
      expect((await verifyAuditChain(db, workspace.id)).broken).toMatchObject({
        seq: 1,
        reason: 'unverifiable',
      });
    } finally {
      configureAuditKeys(devKeyring);
    }
  });

  test('production refuses to run without a key, or with the development one', () => {
    expect(() => auditKeyringFromEnv({ NODE_ENV: 'production' })).toThrow(/AUDIT_HMAC_KEYS/);
    expect(() =>
      auditKeyringFromEnv({ NODE_ENV: 'production', AUDIT_HMAC_KEYS: `dev:${KEY_D}` }),
    ).toThrow(/development only/);
    expect(() =>
      auditKeyringFromEnv({ NODE_ENV: 'production', AUDIT_HMAC_KEYS: 'k1:c2hvcnQ=' }),
    ).toThrow(/under 32 bytes/);
    expect(
      auditKeyringFromEnv({ NODE_ENV: 'production', AUDIT_HMAC_KEYS: `k1:${KEY_E}` }).currentId,
    ).toBe('k1');
  });
});

describe('export and verification over HTTP', () => {
  test('pages forwards from a cursor with no gaps and no repeats', async () => {
    const { owner, workspace } = await workspaceWithEvents(25);
    const base = `/workspaces/${workspace.id}/audit/events`;

    const seen: { seq: number; type: string }[] = [];
    let after = 0;

    for (let page = 0; page < 10; page++) {
      const response = await request(`${base}?after=${after}&limit=10`, { actor: owner });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      seen.push(...body.events.map((event: { seq: number; type: string }) => event));
      if (body.nextCursor === null) break;
      after = body.nextCursor;
    }

    // Every page exported is itself recorded, so the walk meets the events it
    // caused; it still ends, with no gap and no repeat.
    expect(seen.map((event) => event.seq)).toEqual(seen.map((_, index) => index + 1));
    expect(seen.length).toBeGreaterThan(27);
    expect(seen.slice(27).every((event) => event.type === 'audit.exported')).toBe(true);
  });

  test('reads newest first by default, and filters by entity and actor', async () => {
    const { owner, workspace } = await workspaceWithEvents(2);
    const helper = await createActor('Helper');
    await addMember(owner, workspace.id, helper, 'MEMBER');
    await createProject(helper, workspace.id, 'Helper Project');

    const base = `/workspaces/${workspace.id}/audit/events`;

    const newest = (await request(base, { actor: owner })).json();
    // workspace, project, two issues, the member invited and joining, then
    // the helper's project.
    expect(newest.events[0].seq).toBe(7);
    expect(newest.events[0].actorName).toBe('Helper');

    const issues = (await request(`${base}?entityType=issue`, { actor: owner })).json();
    expect(issues.events.map((e: { type: string }) => e.type)).toEqual([
      'issue.created',
      'issue.created',
    ]);

    const byHelper = (await request(`${base}?actorId=${helper.id}`, { actor: owner })).json();
    // Joining is the helper's own act, so it is theirs in the trail.
    expect(byHelper.events.map((e: { type: string }) => e.type)).toEqual([
      'project.created',
      'member.joined',
    ]);
  });

  test('exported events carry their key and hashes', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);

    const body = (
      await request(`/workspaces/${workspace.id}/audit/events?after=0`, { actor: owner })
    ).json();
    const [first, second] = body.events;

    expect(first.key).toBeString();
    expect(first.prevHash).toBeNull();
    expect(second.prevHash).toBe(first.hash);
    expect(first.actor).toEqual({ id: owner.id, kind: 'human' });
  });

  test('verify reports the head of an intact chain', async () => {
    const { owner, workspace } = await workspaceWithEvents(2);

    const response = await request(`/workspaces/${workspace.id}/audit/verify`, {
      method: 'POST',
      actor: owner,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, checked: 4, head: { seq: 4 } });
  });

  test('verification is rate-limited per account', async () => {
    const { owner, workspace } = await workspaceWithEvents(0);
    const url = `/workspaces/${workspace.id}/audit/verify`;

    const codes: number[] = [];
    for (let n = 0; n < 11; n++) {
      codes.push((await request(url, { method: 'POST', actor: owner })).statusCode);
    }

    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  test('members cannot read the trail; strangers cannot tell it exists', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const member = await createActor('Member');
    const stranger = await createActor('Stranger');
    await addMember(owner, workspace.id, member, 'MEMBER');

    for (const [path, method] of [
      ['audit/events', 'GET'],
      ['audit/actors', 'GET'],
      ['audit/verify', 'POST'],
    ] as const) {
      const url = `/workspaces/${workspace.id}/${path}`;
      expect((await request(url, { method, actor: member })).statusCode).toBe(403);
      expect((await request(url, { method, actor: stranger })).statusCode).toBe(404);
    }
  });

  test('a malformed page request is a 400, not a guess', async () => {
    const { owner, workspace } = await workspaceWithEvents(0);
    const base = `/workspaces/${workspace.id}/audit/events`;

    for (const query of [
      'limit=0',
      'limit=501',
      'after=-1',
      'after=1e20',
      'after=1&before=5',
      'actorId=x',
    ]) {
      expect((await request(`${base}?${query}`, { actor: owner })).statusCode).toBe(400);
    }
  });
});

describe('looking at the trail is recorded', () => {
  test('reading, exporting and checking each leave an event naming who did it', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const base = `/workspaces/${workspace.id}/audit`;

    await send(owner, 'GET', `${base}/events`);
    await send(owner, 'GET', `${base}/events?after=0`);
    await send(owner, 'POST', `${base}/verify`);

    const events = (await trail(workspace.id)).slice(-3);
    expect(events.map((event) => event.eventType)).toEqual([
      'audit.read',
      'audit.exported',
      'audit.verified',
    ]);
    for (const event of events) expect(event.actorId).toBe(owner.id);
    expect(JSON.parse(events[2]!.payload)).toMatchObject({ ok: true, full: false });
  });

  test('those events stay out of the members’ activity feed', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    await send(owner, 'POST', `/workspaces/${workspace.id}/audit/verify`);

    const feed = await request(`/workspaces/${workspace.id}/activity`, { actor: owner });
    const types = feed.json().events.map((event: { eventType: string }) => event.eventType);
    expect(types.some((type: string) => type.startsWith('audit.'))).toBe(false);
  });
});

describe('checkpoints', () => {
  const verify = async (actor: Actor, workspaceId: string, full = false) => {
    const response = await request(
      `/workspaces/${workspaceId}/audit/verify${full ? '?full=1' : ''}`,
      { method: 'POST', actor },
    );
    return response.json();
  };

  test('a second check walks only what came after the first', async () => {
    const { owner, workspace, project } = await workspaceWithEvents(2);

    const first = await verify(owner, workspace.id);
    expect(first).toMatchObject({ ok: true, fromSeq: 0, checkpoint: 'none' });

    await send(owner, 'POST', `/workspaces/${workspace.id}/projects/${project.id}/issues`, {
      title: 'After the first check',
    });

    const second = await verify(owner, workspace.id);
    // From the first check's head; it walks that check's own event and the
    // new issue's, not everything again.
    expect(second).toMatchObject({ ok: true, fromSeq: first.head.seq, checkpoint: 'used' });
    expect(second.checked).toBe(2);
  });

  test('a checkpoint changed in the database is rejected, and the whole chain is walked', async () => {
    const { ownerDb } = await getHarness();
    const { owner, workspace } = await workspaceWithEvents(2);
    await verify(owner, workspace.id);

    // Without the key, any change to it breaks its signature.
    await ownerDb.execute(
      sql`update audit_checkpoints set signed = false where workspace_id = ${workspace.id}`,
    );

    const report = await verify(owner, workspace.id);
    expect(report).toMatchObject({ ok: true, fromSeq: 0, checkpoint: 'rejected' });
  });

  test('a trail cut back past its checkpoint is reported as truncated', async () => {
    const { owner, workspace } = await workspaceWithEvents(3);
    const first = await verify(owner, workspace.id);

    await tamper(
      sql`delete from audit_events where workspace_id = ${workspace.id} and seq >= ${first.head.seq - 1}`,
    );

    const report = await verify(owner, workspace.id);
    expect(report.ok).toBe(false);
    expect(report.broken).toMatchObject({ reason: 'truncated' });
  });

  test('an edit behind the checkpoint is what the full check is for', async () => {
    const { owner, workspace } = await workspaceWithEvents(3);
    await verify(owner, workspace.id);

    await tamper(
      sql`update audit_events set payload = '{"edited":true}'
          where workspace_id = ${workspace.id} and seq = 2`,
    );

    // The quick check starts after the checkpoint, so it does not see it...
    expect((await verify(owner, workspace.id)).ok).toBe(true);
    // ...and the full one does.
    expect((await verify(owner, workspace.id, true)).broken).toMatchObject({
      seq: 2,
      reason: 'altered',
    });
  });

  test('full checks have their own, smaller budget', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const full = () =>
      request(`/workspaces/${workspace.id}/audit/verify?full=1`, { method: 'POST', actor: owner });

    expect((await full()).statusCode).toBe(200);
    expect((await full()).statusCode).toBe(200);
    expect((await full()).statusCode).toBe(429);
    // The quick check is unaffected.
    expect(
      (await request(`/workspaces/${workspace.id}/audit/verify`, { method: 'POST', actor: owner }))
        .statusCode,
    ).toBe(200);
  });
});

describe('who appears in the trail', () => {
  test('former members can still be picked, by username', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const helper = await createActor('Helper');
    await addMember(owner, workspace.id, helper, 'MEMBER');
    await createProject(helper, workspace.id, 'Helper Project');
    await send(owner, 'DELETE', `/workspaces/${workspace.id}/members/${helper.id}`);

    const response = await request(`/workspaces/${workspace.id}/audit/actors`, { actor: owner });
    expect(response.statusCode).toBe(200);
    expect(response.json().actors).toEqual([
      { id: owner.id, username: owner.username, name: owner.name, former: false },
      { id: helper.id, username: helper.username, name: helper.name, former: true },
    ]);
  });

  test('members without the audit permission cannot list them', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');

    const response = await request(`/workspaces/${workspace.id}/audit/actors`, { actor: member });
    expect(response.statusCode).toBe(403);
  });
});

describe('reading is recorded without being forged or flooded', () => {
  test('a cross-site page navigation cannot read, and so cannot record a read', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const before = (await trail(workspace.id)).length;

    for (const headers of [
      { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' },
      { 'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'navigate' },
    ]) {
      const response = await request(`/workspaces/${workspace.id}/audit/events`, {
        actor: owner,
        headers,
      });
      expect(response.statusCode).toBe(403);
    }
    expect(await trail(workspace.id)).toHaveLength(before);
  });

  test('checking is a POST: a link cannot run it', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const response = await request(`/workspaces/${workspace.id}/audit/verify`, { actor: owner });
    expect(response.statusCode).toBe(404);
  });

  test('reads by one person within a minute are recorded once', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    for (let n = 0; n < 3; n++)
      await send(owner, 'GET', `/workspaces/${workspace.id}/audit/events`);
    await send(owner, 'GET', `/workspaces/${workspace.id}/audit/actors`);

    const reads = (await trail(workspace.id)).filter((event) => event.eventType === 'audit.read');
    expect(reads).toHaveLength(1);
  });

  test('an export page must be big enough for the walk to finish', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const response = await request(`/workspaces/${workspace.id}/audit/events?after=0&limit=1`, {
      actor: owner,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('page_too_small');
  });
});

describe('the checkpoint itself', () => {
  test('may not move backwards, or be removed, even by the owner', async () => {
    const { ownerDb } = await getHarness();
    const { owner, workspace } = await workspaceWithEvents(2);
    await send(owner, 'POST', `/workspaces/${workspace.id}/audit/verify`);
    const run = async (statement: ReturnType<typeof sql>) => ownerDb.execute(statement);

    await expect(
      run(sql`update audit_checkpoints set seq = 1 where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/only move forward/);
    await expect(
      run(sql`delete from audit_checkpoints where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/go only with their workspace/);
  });

  test('an event changed under the checkpoint makes it stale, and the check walks it all', async () => {
    const { owner, workspace } = await workspaceWithEvents(2);
    const first = (
      await request(`/workspaces/${workspace.id}/audit/verify`, { method: 'POST', actor: owner })
    ).json();

    await tamper(
      sql`update audit_events set payload = '{"edited":true}'
          where workspace_id = ${workspace.id} and seq = ${first.head.seq}`,
    );

    const report = (
      await request(`/workspaces/${workspace.id}/audit/verify`, { method: 'POST', actor: owner })
    ).json();
    expect(report).toMatchObject({ ok: false, checkpoint: 'stale', fromSeq: 0 });
    expect(report.broken).toMatchObject({ seq: first.head.seq, reason: 'altered' });
  });
});

describe('erasing a person (a design, for legal review)', () => {
  async function memberChurn() {
    const { owner, workspace } = await workspaceWithEvents(1);
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    await send(owner, 'DELETE', `/workspaces/${workspace.id}/members/${member.id}`);
    return { owner, workspace, member };
  }

  test('a member event keeps the username outside the hashed payload', async () => {
    const { db } = await getHarness();
    const { workspace, member } = await memberChurn();
    const added = (await trail(workspace.id)).find((event) => event.eventType === 'member.joined')!;

    expect(JSON.parse(added.payload)).toEqual({ role: 'MEMBER' });
    expect(JSON.parse(added.personal!)).toEqual({ username: member.username });
    expect(added.personalSubjectId).toBe(member.id);
    expect((await verifyAuditChain(db, workspace.id)).ok).toBe(true);
  });

  test('erasing removes the username everywhere, and the chain still verifies', async () => {
    const { db } = await getHarness();
    const { owner, workspace, member } = await memberChurn();

    // Invited, joined, removed.
    expect(await eraseAuditPersonalData(db, member.id)).toBe(3);

    for (const event of await trail(workspace.id)) {
      expect(event.personal).toBeNull();
      expect(event.personalSalt).toBeNull();
      expect(JSON.stringify(event)).not.toContain(member.username);
    }
    expect((await verifyAuditChain(db, workspace.id)).ok).toBe(true);

    // What a member sees now names nobody.
    const feed = await request(`/workspaces/${workspace.id}/activity`, { actor: owner });
    expect(feed.body).not.toContain(member.username);
  });

  test('personal fields changed behind the app are caught', async () => {
    const { db } = await getHarness();
    const { workspace } = await memberChurn();

    await tamper(
      sql`update audit_events set personal = '{"username":"someone_else"}'
          where workspace_id = ${workspace.id} and event_type = 'member.joined'`,
    );

    expect((await verifyAuditChain(db, workspace.id)).broken?.reason).toBe('altered');
  });

  test('the runtime role can erase, and do nothing else with that right', async () => {
    const { db } = await getHarness();
    const { workspace } = await memberChurn();
    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    // Rewriting the fields rather than erasing them is refused by the trigger...
    await expect(
      run(sql`update audit_events set personal = '{"username":"x"}'
              where workspace_id = ${workspace.id} and personal is not null`),
    ).rejects.toThrow(/append-only/);
    // ...and every other column is out of the role's reach entirely.
    await expect(
      run(sql`update audit_events set payload = '{}' where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('erasure cannot be steered', () => {
  test('personal fields re-pointed at someone else are caught', async () => {
    const { db } = await getHarness();
    const { owner, workspace } = await workspaceWithEvents(1);
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');

    await tamper(
      sql`update audit_events set personal_subject_id = ${owner.id}
          where workspace_id = ${workspace.id} and event_type = 'member.joined'`,
    );

    expect((await verifyAuditChain(db, workspace.id)).broken?.reason).toBe('altered');
  });
});
