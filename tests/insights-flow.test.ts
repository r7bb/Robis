import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  cycleTimeOf,
  type IssueSpan,
  issueSpan,
  projectFlow,
  quantile,
  WEEK_MS,
  weeklyCounts,
} from '@robis/api/insights-flow';
import { auditEvents, issues } from '@robis/database';
import { and, asc, eq, sql } from 'drizzle-orm';
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
 * Insights: cycle time and throughput (Phase 6). Done when: figures
 * computed over a seeded history match hand computed answers; an issue
 * counts by its last move to done and only while still done; one with no
 * recorded start is counted but not timed; below the minimum sample a
 * project gets its counts and no figures; and the figures are for members
 * who may read issues, nobody else.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const DAY = 86_400_000;
const NOW = new Date('2026-11-20T12:00:00Z');
const at = (daysAgo: number, now = NOW) => new Date(now.getTime() - daysAgo * DAY);
const move = (daysAgo: number, from: string, to: string) => ({ at: at(daysAgo), from, to });

describe('the rules, without a database', () => {
  test('quantiles interpolate between neighbours, as percentile_cont does', () => {
    const values = [1, 2, 3, 4];
    expect(quantile(values, 0.5)).toBe(2.5);
    expect(quantile(values, 0.25)).toBe(1.75);
    expect(quantile(values, 0.9)).toBeCloseTo(3.7, 10);
    expect(quantile([7], 0.9)).toBe(7);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
  });

  const done = (
    createdAt: Date,
    moves: ReturnType<typeof move>[],
    completedAt = null as Date | null,
  ) => issueSpan({ createdAt, completedAt, moves });

  test('started at the first move into work, finished at the last move to done', () => {
    const span = done(at(30), [
      move(20, 'TODO', 'IN_PROGRESS'),
      move(15, 'IN_PROGRESS', 'IN_REVIEW'),
      move(5, 'IN_REVIEW', 'DONE'),
    ]);
    expect(span).toEqual({ startedAt: at(20), doneAt: at(5) });
  });

  test('a reopened issue starts again from the reopen, not its first start', () => {
    // Started, done, reopened to to do, started again and redone.
    expect(
      done(at(30), [
        move(20, 'TODO', 'IN_PROGRESS'),
        move(15, 'IN_PROGRESS', 'DONE'),
        move(12, 'DONE', 'TODO'),
        move(8, 'TODO', 'IN_REVIEW'),
        move(5, 'IN_REVIEW', 'DONE'),
      ]),
    ).toEqual({ startedAt: at(8), doneAt: at(5) });
    // Reopened straight into work: the reopen is the start.
    expect(
      done(at(30), [
        move(20, 'TODO', 'DONE'),
        move(6, 'DONE', 'IN_PROGRESS'),
        move(2, 'IN_PROGRESS', 'DONE'),
      ]),
    ).toEqual({ startedAt: at(6), doneAt: at(2) });
    // Reopened to to do and closed again with no work: untimed, even though
    // the first round was started, and created in work long before.
    expect(
      done(at(30), [
        move(20, 'IN_PROGRESS', 'DONE'),
        move(6, 'DONE', 'TODO'),
        move(2, 'TODO', 'DONE'),
      ]),
    ).toEqual({ startedAt: null, doneAt: at(2) });
  });

  test('created in work started when it was created', () => {
    expect(done(at(9), [move(2, 'IN_PROGRESS', 'DONE')])).toEqual({
      startedAt: at(9),
      doneAt: at(2),
    });
  });

  test('straight from to do to done has no start', () => {
    expect(done(at(9), [move(2, 'TODO', 'DONE')])).toEqual({ startedAt: null, doneAt: at(2) });
  });

  test('filed already done finished when it was filed, with no start', () => {
    expect(done(at(9), [], at(9))).toEqual({ startedAt: null, doneAt: at(9) });
  });

  test('an issue reopened and not redone is not finished', () => {
    expect(done(at(9), [move(4, 'TODO', 'DONE'), move(2, 'DONE', 'TODO')], at(4))).toBeNull();
    expect(done(at(9), [], null)).toBeNull();
  });

  test('weeks are seven-day steps back from now, the last one the last seven days', () => {
    const counts = weeklyCounts(
      [
        at(0),
        at(6.99),
        at(7),
        at(83.9),
        at(84.1), // just outside the twelve weeks
        new Date(NOW.getTime() + 60_000), // a moment ahead, on another clock
      ],
      NOW,
    );
    expect(counts).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3]);
    expect(counts.length).toBe(12);
  });

  test('below ten timed issues there is no cycle time; at ten there is', () => {
    const spans = (n: number): IssueSpan[] =>
      Array.from({ length: n }, (_, i) => ({ startedAt: at(i + 2), doneAt: at(1) }));
    expect(cycleTimeOf(spans(9))).toBeNull();
    expect(cycleTimeOf(spans(10))).not.toBeNull();
    // Untimed spans do not make up the number.
    expect(cycleTimeOf([...spans(9), { startedAt: null, doneAt: at(1) }])).toBeNull();
  });

  test('only spans finished in the window count, the edge itself outside', () => {
    const flow = projectFlow(
      [
        { startedAt: at(100), doneAt: at(90) },
        { startedAt: at(90), doneAt: at(84) }, // exactly twelve weeks ago
        { startedAt: null, doneAt: at(3) },
      ],
      NOW,
    );
    expect(flow).toEqual({ finished: 1, measured: 0, throughput: null, cycleTime: null });
  });
});

/*
 * A seeded history. Moves go through the API, so the trail holds exactly
 * what a person's clicks would leave; then their times are moved into the
 * past, behind the append-only trigger, the way a table owner could.
 */

const realNow = () => new Date();

async function backdate(issueId: string, createdDaysAgo: number, movesDaysAgo: number[]) {
  const { ownerDb } = await getHarness();
  const now = realNow();
  const moves = await ownerDb
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(
      and(eq(auditEvents.entityId, issueId), eq(auditEvents.eventType, 'issue.status_changed')),
    )
    .orderBy(asc(auditEvents.seq));
  expect(moves.length).toBe(movesDaysAgo.length);
  await ownerDb.transaction(async (tx) => {
    await tx.execute(sql`alter table audit_events disable trigger audit_events_append_only`);
    for (const [i, row] of moves.entries()) {
      await tx
        .update(auditEvents)
        .set({ createdAt: at(movesDaysAgo[i]!, now) })
        .where(eq(auditEvents.id, row.id));
    }
    await tx.execute(sql`alter table audit_events enable trigger audit_events_append_only`);
  });
  await ownerDb
    .update(issues)
    .set({ createdAt: at(createdDaysAgo, now), completedAt: at(movesDaysAgo.at(-1) ?? 0, now) })
    .where(eq(issues.id, issueId));
}

/** An issue taken through `path` ([status, days ago] in order), then backdated. */
async function story(
  actor: Actor,
  workspaceId: string,
  projectId: string,
  path: [string, number][],
) {
  const made = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    actor,
    payload: { title: 'A piece of work' },
  });
  expect(made.statusCode).toBe(201);
  const id = made.json().issue.id as string;
  for (const [status] of path) {
    const moved = await request(`/workspaces/${workspaceId}/issues/${id}`, {
      method: 'PATCH',
      actor,
      payload: { status },
    });
    expect(moved.statusCode).toBe(200);
  }
  const created = (path[0]?.[1] ?? 0) + 1;
  await backdate(
    id,
    created,
    path.map(([, daysAgo]) => daysAgo),
  );
  return id;
}

type Flow = {
  key: string;
  finished: number;
  measured: number;
  throughput: number[] | null;
  cycleTime: Record<string, number> | null;
};

async function flowOf(actor: Actor, workspaceId: string) {
  const reply = await request(`/workspaces/${workspaceId}/insights/flow`, { actor });
  expect(reply.statusCode).toBe(200);
  return reply.json() as { weeks: number; minSample: number; projects: Flow[] };
}

describe('over a seeded history', () => {
  test('the figures match the answers worked by hand', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    const web = await createProject(owner, workspace.id, 'Web App');
    const api = await createProject(owner, workspace.id, 'Platform API');
    const docs = await createProject(owner, workspace.id, 'Docs');

    // Ten timed issues on Web App: the i-th took i days, finished 5i - 1.5 days ago.
    for (let i = 1; i <= 10; i++) {
      const done = 5 * i - 1.5;
      await story(owner, workspace.id, web.id, [
        ['IN_PROGRESS', done + i],
        ['DONE', done],
      ]);
    }
    // Straight to done: counted, not timed.
    await story(owner, workspace.id, web.id, [['DONE', 2.5]]);
    // Finished thirteen weeks ago: outside the window.
    await story(owner, workspace.id, web.id, [
      ['IN_PROGRESS', 100],
      ['DONE', 95],
    ]);
    // Filed already done: finished when filed, not timed, and the same
    // issue the Feed counts.
    const filed = await request(`/workspaces/${workspace.id}/projects/${api.id}/issues`, {
      method: 'POST',
      actor: owner,
      payload: { title: 'Filed as done', status: 'DONE' },
    });
    expect(filed.statusCode).toBe(201);
    // Done, then reopened: not finished.
    await story(owner, workspace.id, web.id, [
      ['IN_PROGRESS', 20],
      ['DONE', 10],
      ['IN_PROGRESS', 4],
    ]);
    // Canceled: never finished.
    await story(owner, workspace.id, web.id, [['CANCELED', 6]]);
    // Three more on Platform API: too few for figures.
    for (const done of [1.5, 2.5, 3.5]) {
      await story(owner, workspace.id, api.id, [
        ['IN_REVIEW', done + 1],
        ['DONE', done],
      ]);
    }

    const flow = await flowOf(owner, workspace.id);
    expect(flow.weeks).toBe(12);
    expect(flow.minSample).toBe(10);
    expect(flow.projects.map((project) => [project.key, project.finished])).toEqual([
      [web.key, 11],
      [api.key, 4],
      [docs.key, 0],
    ]);

    const [webFlow, apiFlow, docsFlow] = flow.projects;
    expect(webFlow!.measured).toBe(10);
    // Finished 3.5, 8.5, 13.5 ... 48.5 days ago, plus the untimed one 2.5 days ago,
    // so weeks back from now: 0, 1, 1, 2, 3, 4, 4, 5, 6, 6 and 0.
    expect(webFlow!.throughput).toEqual([0, 0, 0, 0, 0, 2, 1, 2, 1, 1, 2, 2]);
    // Cycle times 1 to 10 days. Median (5 + 6) / 2; the quartiles and the
    // 90th percentile at positions 2.25, 6.75 and 8.1 of the sorted ten.
    const days = (seconds: number) => seconds / 86_400;
    expect(days(webFlow!.cycleTime!.medianSeconds!)).toBeCloseTo(5.5, 3);
    expect(days(webFlow!.cycleTime!.p25Seconds!)).toBeCloseTo(3.25, 3);
    expect(days(webFlow!.cycleTime!.p75Seconds!)).toBeCloseTo(7.75, 3);
    expect(days(webFlow!.cycleTime!.p90Seconds!)).toBeCloseTo(9.1, 3);

    expect(apiFlow).toMatchObject({ finished: 4, measured: 3, throughput: null, cycleTime: null });
    expect(docsFlow).toMatchObject({ finished: 0, measured: 0, throughput: null, cycleTime: null });
  });

  test("another workspace's history does not leak in", async () => {
    const owner = await createActor('Owner');
    const mine = await createWorkspace(owner, 'Mine');
    await createProject(owner, mine.id, 'Web App');
    const theirs = await createWorkspace(owner, 'Theirs');
    const theirProject = await createProject(owner, theirs.id, 'Web App');
    await story(owner, theirs.id, theirProject.id, [
      ['IN_PROGRESS', 3],
      ['DONE', 1],
    ]);

    const flow = await flowOf(owner, mine.id);
    expect(flow.projects).toHaveLength(1);
    expect(flow.projects[0]!.finished).toBe(0);
  });
});

describe('who may see it', () => {
  test('a guest may, a stranger gets 404, and nobody signed out gets in', async () => {
    const owner = await createActor('Owner');
    const workspace = await createWorkspace(owner);
    await createProject(owner, workspace.id);
    const guest = await createActor('Guest');
    await addMember(owner, workspace.id, guest, 'GUEST');
    const stranger = await createActor('Stranger');

    const url = `/workspaces/${workspace.id}/insights/flow`;
    expect((await request(url, { actor: guest })).statusCode).toBe(200);
    expect((await request(url, { actor: stranger })).statusCode).toBe(404);
    expect((await request(url)).statusCode).toBe(401);
  });
});

test('a week is seven days', () => {
  expect(WEEK_MS).toBe(7 * DAY);
});
