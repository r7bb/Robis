import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { advanceStreamCursor, auditEvents, recordAudit, verifyAuditChain } from '@robis/database';
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
  method: 'POST' | 'PATCH' | 'DELETE',
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
  const { db } = await getHarness();
  await db.transaction(async (tx) => {
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
      'member.added',
      'member.role_changed',
      'member.removed',
      'member.added',
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

  test('an event rewritten with a fresh hash is caught at the next link', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(4);

    // A careful forger recomputes the hash of the row they changed. The row
    // checks out on its own; the one after it no longer points at it.
    await tamper(sql`
      update audit_events
      set payload = '{"forged":true}',
          hash = robis_audit_hash(prev_hash, workspace_id, seq, actor_id, actor_kind::text,
            request_id, entity_type, entity_id, event_type, '{"forged":true}', created_at)
      where workspace_id = ${workspace.id} and seq = 3
    `);

    const report = await verifyAuditChain(db, workspace.id);
    expect(report.broken).toMatchObject({ seq: 4, reason: 'relinked' });
  });

  test('the database refuses ordinary edits and deletes outright', async () => {
    const { db } = await getHarness();
    const { workspace } = await workspaceWithEvents(1);

    // Drizzle builders are lazy thenables; `rejects` needs a real promise.
    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    await expect(
      run(sql`update audit_events set payload = '{}' where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/append-only/);
    await expect(
      run(sql`delete from audit_events where workspace_id = ${workspace.id}`),
    ).rejects.toThrow(/append-only/);
  });

  test('deleting the workspace still takes its trail with it', async () => {
    const { owner, workspace } = await workspaceWithEvents(2);

    const deleted = await request(`/workspaces/${workspace.id}`, {
      method: 'DELETE',
      actor: owner,
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
    const { db } = await getHarness();
    await workspaceWithEvents(1);

    const run = async (statement: ReturnType<typeof sql>) => db.execute(statement);

    await expect(run(sql`truncate audit_events`)).rejects.toThrow(/cannot be truncated/);
    await expect(run(sql`truncate workspaces cascade`)).rejects.toThrow(/cannot be truncated/);
  });

  test('the SQL copy of the hash agrees with the application, unicode and all', async () => {
    const { db } = await getHarness();
    const owner = await createActor('Owner');
    const ws = await createWorkspace(owner, 'Café ☕ 𝄞');

    const rows = await db.execute<{ stored: string; recomputed: string }>(sql`
      select hash as stored,
        robis_audit_hash(prev_hash, workspace_id, seq, actor_id, actor_kind::text, request_id,
          entity_type, entity_id, event_type, payload, created_at) as recomputed
      from audit_events where workspace_id = ${ws.id}
    `);

    expect(rows.length).toBe(1);
    expect(rows[0]?.recomputed).toBe(rows[0]!.stored);
  });
});

describe('export and verification over HTTP', () => {
  test('pages forwards from a cursor with no gaps and no repeats', async () => {
    const { owner, workspace } = await workspaceWithEvents(5);
    const base = `/workspaces/${workspace.id}/audit/events`;

    const seen: number[] = [];
    let after = 0;

    for (let page = 0; page < 10; page++) {
      const response = await request(`${base}?after=${after}&limit=3`, { actor: owner });
      expect(response.statusCode).toBe(200);

      const body = response.json();
      seen.push(...body.events.map((event: { seq: number }) => event.seq));
      if (body.nextCursor === null) break;
      after = body.nextCursor;
    }

    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('reads newest first by default, and filters by entity and actor', async () => {
    const { owner, workspace } = await workspaceWithEvents(2);
    const helper = await createActor('Helper');
    await addMember(owner, workspace.id, helper, 'MEMBER');
    await createProject(helper, workspace.id, 'Helper Project');

    const base = `/workspaces/${workspace.id}/audit/events`;

    const newest = (await request(base, { actor: owner })).json();
    // workspace, project, two issues, the member added, then the helper's project.
    expect(newest.events[0].seq).toBe(6);
    expect(newest.events[0].actorName).toBe('Helper');

    const issues = (await request(`${base}?entityType=issue`, { actor: owner })).json();
    expect(issues.events.map((e: { type: string }) => e.type)).toEqual([
      'issue.created',
      'issue.created',
    ]);

    const byHelper = (await request(`${base}?actorId=${helper.id}`, { actor: owner })).json();
    expect(byHelper.events.map((e: { type: string }) => e.type)).toEqual(['project.created']);
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

    const response = await request(`/workspaces/${workspace.id}/audit/verify`, { actor: owner });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, checked: 4, head: { seq: 4 } });
  });

  test('verification is rate-limited per account', async () => {
    const { owner, workspace } = await workspaceWithEvents(0);
    const url = `/workspaces/${workspace.id}/audit/verify`;

    const codes: number[] = [];
    for (let n = 0; n < 11; n++) codes.push((await request(url, { actor: owner })).statusCode);

    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  test('members cannot read the trail; strangers cannot tell it exists', async () => {
    const { owner, workspace } = await workspaceWithEvents(1);
    const member = await createActor('Member');
    const stranger = await createActor('Stranger');
    await addMember(owner, workspace.id, member, 'MEMBER');

    for (const path of ['audit/events', 'audit/verify']) {
      const url = `/workspaces/${workspace.id}/${path}`;
      expect((await request(url, { actor: member })).statusCode).toBe(403);
      expect((await request(url, { actor: stranger })).statusCode).toBe(404);
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
