import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  advanceStreamCursor,
  auditStreamCursors,
  type ExportedAuditEvent,
  enqueue,
  hasPendingJob,
  jobs,
} from '@robis/database';
import {
  type AuditStreamConfig,
  auditStreamConfig,
  httpSink,
  streamAuditEvents,
} from '@robis/worker/audit-stream';
import { Runner } from '@robis/worker/runner';
import { eq, sql } from 'drizzle-orm';
import {
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

/**
 * A stand-in SIEM receiver on a random local port.
 *
 * It does what a real ingest endpoint does with an idempotency key: stores
 * by key, so a redelivered event overwrites itself instead of counting
 * twice. `failOn` names requests (counting from 1) that are stored and
 * then answered with a 500 -- the response lost after the data arrived,
 * which is exactly the case that forces a resend.
 */
function startReceiver() {
  const byKey = new Map<string, ExportedAuditEvent>();
  const state = {
    received: 0,
    requests: 0,
    failOn: new Set<number>(),
    lastAuth: null as string | null,
  };

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      state.requests++;
      state.lastAuth = req.headers.get('authorization');

      const body = (await req.json()) as { source: string; events: ExportedAuditEvent[] };
      for (const event of body.events) {
        state.received++;
        byKey.set(event.key, event);
      }

      if (state.failOn.has(state.requests)) {
        return new Response('stored, but this answer is lost', { status: 500 });
      }
      return new Response(null, { status: 204 });
    },
  });

  const config: AuditStreamConfig = {
    url: new URL(`http://localhost:${server.port}/ingest`),
    token: 'siem-token',
    intervalMs: 1000,
  };

  return { server, byKey, state, config };
}

let receiver: ReturnType<typeof startReceiver>;

beforeEach(() => {
  receiver = startReceiver();
});

afterEach(() => {
  receiver.server.stop(true);
});

/** Two workspaces with a few events each, written through the API. */
async function twoBusyWorkspaces() {
  const owner = await createActor('Owner');
  const seeded = [];

  for (const name of ['Alpha', 'Beta']) {
    const workspace = await createWorkspace(owner, name);
    const project = await createProject(owner, workspace.id);

    for (let n = 0; n < 4; n++) {
      await request(`/workspaces/${workspace.id}/projects/${project.id}/issues`, {
        method: 'POST',
        actor: owner,
        payload: { title: `${name} ${n}` },
      });
    }

    seeded.push(workspace);
  }

  // workspace.created, project.created and four issues each.
  return { owner, workspaces: seeded, total: 12 };
}

describe('delivery', () => {
  test('every event arrives exactly once by key, despite a forced retry through the queue', async () => {
    const { db } = await getHarness();
    const { workspaces, total } = await twoBusyWorkspaces();

    // Small batches so the failure lands mid-stream, after some progress.
    const sink = httpSink(receiver.config);
    const runner = new Runner({
      db,
      handlers: {
        'audit.stream': async (_p, ctx) => void (await streamAuditEvents(ctx.db, sink, 4)),
      },
    });

    await enqueue(db, 'audit.stream', {}, { maxAttempts: 10 });

    // The first batch is acknowledged; the second is stored and its answer
    // lost. That workspace stops there, the other is delivered in full (two
    // more requests), and the job fails having made real progress.
    receiver.state.failOn = new Set([2]);
    const first = await runner.tick();
    expect(first).toMatchObject({ claimed: 1, failed: 1 });
    expect(receiver.state.requests).toBe(4);

    // The queue backs the job off; make it due now rather than wait. The
    // retry resumes at the unacknowledged batch, not at the beginning.
    await db.update(jobs).set({ runAt: new Date() });
    const second = await runner.tick();
    expect(second).toMatchObject({ claimed: 1, completed: 1 });

    // The lost batch -- the first workspace's last two events, since six go
    // out as four and two -- was sent twice, and nothing else was...
    expect(receiver.state.received).toBe(total + 2);
    // ...and, deduplicated by key, every one is there exactly once.
    expect(receiver.byKey.size).toBe(total);

    for (const workspace of workspaces) {
      const seqs = [...receiver.byKey.values()]
        .filter((event) => event.workspaceId === workspace.id)
        .map((event) => event.seq)
        .sort((a, b) => a - b);
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  test('a later run sends only what is new', async () => {
    const { db } = await getHarness();
    const { owner, workspaces } = await twoBusyWorkspaces();
    const sink = httpSink(receiver.config);

    expect(await streamAuditEvents(db, sink)).toEqual({ delivered: 12 });
    expect(await streamAuditEvents(db, sink)).toEqual({ delivered: 0 });

    await createProject(owner, workspaces[0]!.id, 'Late');
    const before = receiver.state.received;

    expect(await streamAuditEvents(db, sink)).toEqual({ delivered: 1 });
    expect(receiver.state.received - before).toBe(1);
  });

  test('events carry the chain, so the receiver can check it independently', async () => {
    const { db } = await getHarness();
    await twoBusyWorkspaces();

    await streamAuditEvents(db, httpSink(receiver.config));

    const events = [...receiver.byKey.values()].sort(
      (a, b) => a.workspaceId.localeCompare(b.workspaceId) || a.seq - b.seq,
    );
    for (let i = 1; i < events.length; i++) {
      const [previous, current] = [events[i - 1]!, events[i]!];
      if (previous.workspaceId === current.workspaceId) {
        expect(current.prevHash).toBe(previous.hash);
      }
    }
    expect(receiver.state.lastAuth).toBe('Bearer siem-token');
  });

  test('a workspace the receiver rejects does not hold up the others', async () => {
    const { db } = await getHarness();
    const { workspaces } = await twoBusyWorkspaces();
    const [refused] = [...workspaces].sort((a, b) => a.id.localeCompare(b.id));

    // A receiver that refuses one tenant's events outright.
    const choosy = {
      send: async (events: ExportedAuditEvent[]) => {
        if (events[0]?.workspaceId === refused!.id) throw new Error('receiver answered 413');
        await httpSink(receiver.config).send(events);
      },
    };

    await expect(streamAuditEvents(db, choosy)).rejects.toThrow('1 workspace(s) not delivered');

    // The other workspace was delivered in full anyway.
    expect(receiver.byKey.size).toBe(6);
    expect([...receiver.byKey.values()].every((e) => e.workspaceId !== refused!.id)).toBe(true);
  });

  test('restarting the worker does not start a second stream', async () => {
    const { db } = await getHarness();

    expect(await hasPendingJob(db, 'audit.stream')).toBe(false);
    await enqueue(db, 'audit.stream', {});
    expect(await hasPendingJob(db, 'audit.stream')).toBe(true);
  });

  test('the cursor never moves backwards', async () => {
    const { db } = await getHarness();
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);

    await advanceStreamCursor(db, workspace.id, 9);
    await advanceStreamCursor(db, workspace.id, 4);

    const [cursor] = await db
      .select()
      .from(auditStreamCursors)
      .where(eq(auditStreamCursors.workspaceId, workspace.id));
    expect(cursor?.deliveredSeq).toBe(9);
  });

  test('a deleted workspace takes its cursor with it', async () => {
    const { db } = await getHarness();
    const { owner, workspaces } = await twoBusyWorkspaces();
    await streamAuditEvents(db, httpSink(receiver.config));

    await request(`/workspaces/${workspaces[0]!.id}`, { method: 'DELETE', actor: owner });

    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_stream_cursors`,
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('the HTTP sink', () => {
  test('a redirect is a failure, so the token never follows it elsewhere', async () => {
    const redirecting = Bun.serve({
      port: 0,
      fetch: () => Response.redirect('https://elsewhere.example/ingest', 307),
    });

    try {
      const sink = httpSink({
        ...receiver.config,
        url: new URL(`http://localhost:${redirecting.port}`),
      });
      await expect(sink.send([])).rejects.toThrow('receiver answered 307');
    } finally {
      redirecting.stop(true);
    }
  });

  test('a refusal names the status, not whatever the receiver said', async () => {
    const refusing = Bun.serve({
      port: 0,
      fetch: () => new Response('<html>secret stack trace</html>', { status: 503 }),
    });

    try {
      const sink = httpSink({
        ...receiver.config,
        url: new URL(`http://localhost:${refusing.port}`),
      });
      const failure = await sink.send([]).catch((error: Error) => error);
      expect(String(failure)).toContain('503');
      expect(String(failure)).not.toContain('secret');
    } finally {
      refusing.stop(true);
    }
  });
});

describe('configuration', () => {
  test('no receiver configured means no stream', () => {
    expect(auditStreamConfig({})).toBeNull();
    expect(auditStreamConfig({ AUDIT_STREAM_URL: '  ' })).toBeNull();
  });

  test('https anywhere, plain http only to this machine', () => {
    expect(auditStreamConfig({ AUDIT_STREAM_URL: 'https://siem.example/in' })?.url.host).toBe(
      'siem.example',
    );
    expect(auditStreamConfig({ AUDIT_STREAM_URL: 'http://127.0.0.1:9000/in' })).not.toBeNull();
    expect(auditStreamConfig({ AUDIT_STREAM_URL: 'http://[::1]:9000/in' })).not.toBeNull();
    expect(() => auditStreamConfig({ AUDIT_STREAM_URL: 'http://siem.example/in' })).toThrow(
      'https',
    );
  });

  test('a bad value stops the worker instead of streaming nowhere', () => {
    expect(() => auditStreamConfig({ AUDIT_STREAM_URL: 'not a url' })).toThrow('not a valid URL');
    expect(() => auditStreamConfig({ AUDIT_STREAM_URL: 'https://u:p@siem.example' })).toThrow(
      'credentials',
    );
    expect(() =>
      auditStreamConfig({
        AUDIT_STREAM_URL: 'https://siem.example',
        AUDIT_STREAM_INTERVAL_MS: '5',
      }),
    ).toThrow('at least 1000');
  });

  test('the token is optional and trimmed', () => {
    const config = auditStreamConfig({
      AUDIT_STREAM_URL: 'https://siem.example',
      AUDIT_STREAM_TOKEN: ' abc ',
    });
    expect(config?.token).toBe('abc');
    expect(config?.intervalMs).toBe(10_000);
  });

  test('a token that cannot go in a header is refused at boot', () => {
    expect(() =>
      auditStreamConfig({ AUDIT_STREAM_URL: 'https://siem.example', AUDIT_STREAM_TOKEN: 'a b' }),
    ).toThrow('printable ASCII');
  });
});
