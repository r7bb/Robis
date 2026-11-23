import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { evaluateAutomation, matches } from '@robis/api/automation';
import { runAutomationJobs } from '@robis/api/automation-runner';
import {
  AUTOMATION_JOB,
  AUTOMATION_WEBHOOK_JOB,
  auditEvents,
  automationRuns,
  comments,
  issues,
  jobs,
  messages,
  notifications,
} from '@robis/database';
import { isPublicAddress, refusalFor, sendWebhook, signature } from '@robis/worker/webhook';
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
 * Automation rules (B9). Done when: a rule that would trigger itself runs
 * once, and a retried job applies its action once. Also: conditions must
 * all hold, a chain of rules stops at its depth with a note, a label added
 * triggers its rules, the trail names the rule, and only admins manage rules.
 */

beforeEach(resetDatabase);
afterAll(closeHarness);

const quiet = { error() {} };

/** Run automation jobs until none are left, as the API's runner would. */
async function drain() {
  const { db } = await getHarness();
  for (let pass = 0; pass < 20; pass++) {
    if ((await runAutomationJobs(db, 'test-runner', quiet)) === 0) return pass;
  }
  throw new Error('automation jobs never ran out');
}

async function setUp() {
  const owner = await createActor('Owner');
  const workspace = await createWorkspace(owner);
  const project = await createProject(owner, workspace.id);
  return { owner, workspace, project };
}

async function rule(owner: Actor, workspaceId: string, body: Record<string, unknown>) {
  const made = await request(`/workspaces/${workspaceId}/automations`, {
    method: 'POST',
    actor: owner,
    payload: { name: 'A rule', conditions: [], ...body },
  });
  expect(made.statusCode).toBe(201);
  return made.json().rule.id as string;
}

async function file(owner: Actor, workspaceId: string, projectId: string, fields = {}) {
  const made = await request(`/workspaces/${workspaceId}/projects/${projectId}/issues`, {
    method: 'POST',
    actor: owner,
    payload: { title: 'Login is broken', ...fields },
  });
  return made.json().issue.id as string;
}

const statusOf = async (id: string) => {
  const { ownerDb } = await getHarness();
  const [row] = await ownerDb
    .select({ status: issues.status })
    .from(issues)
    .where(eq(issues.id, id));
  return row?.status;
};

const runsOf = async (ruleId: string) => {
  const { ownerDb } = await getHarness();
  return ownerDb
    .select({
      outcome: automationRuns.outcome,
      depth: automationRuns.depth,
      note: automationRuns.note,
    })
    .from(automationRuns)
    .where(eq(automationRuns.ruleId, ruleId));
};

describe('conditions', () => {
  const issue = {
    id: 'i',
    projectId: 'p',
    key: 'WEB-1',
    title: 'Login is broken',
    status: 'TODO',
    priority: 'URGENT',
    assigneeId: null,
    createdBy: null,
    labels: ['bug'],
  };
  test('every condition must hold', () => {
    expect(matches([{ field: 'priority', op: 'is', value: 'URGENT' }], issue, null)).toBe(true);
    expect(
      matches(
        [
          { field: 'priority', op: 'is', value: 'urgent' },
          { field: 'status', op: 'is_not', value: 'TODO' },
        ],
        issue,
        null,
      ),
    ).toBe(false);
    expect(matches([{ field: 'title', op: 'contains', value: 'LOGIN' }], issue, null)).toBe(true);
    expect(matches([{ field: 'assignee', op: 'is', value: 'nobody' }], issue, null)).toBe(true);
    expect(matches([{ field: 'label', op: 'is', value: 'Bug' }], issue, null)).toBe(true);
    // For a label added, only the added labels count.
    expect(matches([{ field: 'label', op: 'is', value: 'bug' }], issue, ['urgent'])).toBe(false);
  });
});

describe('running rules', () => {
  test('a matching rule acts, as itself in the trail; a non-matching one does not', async () => {
    const { owner, workspace, project } = await setUp();
    const urgent = await rule(owner, workspace.id, {
      trigger: 'issue.created',
      conditions: [{ field: 'priority', op: 'is', value: 'URGENT' }],
      action: { kind: 'set_status', status: 'IN_PROGRESS' },
    });
    const hot = await file(owner, workspace.id, project.id, { priority: 'URGENT' });
    const calm = await file(owner, workspace.id, project.id, { priority: 'LOW' });
    await drain();
    expect(await statusOf(hot)).toBe('IN_PROGRESS');
    expect(await statusOf(calm)).toBe('TODO');
    const { ownerDb } = await getHarness();
    const [moved] = await ownerDb
      .select({ actorId: auditEvents.actorId, actorKind: auditEvents.actorKind })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, hot), eq(auditEvents.eventType, 'issue.status_changed')));
    expect(moved).toEqual({ actorId: urgent, actorKind: 'rule' });
    expect((await runsOf(urgent)).map((r) => r.outcome).sort()).toEqual(['applied', 'unmatched']);
  });

  test('a rule that would trigger itself runs once', async () => {
    const { owner, workspace, project } = await setUp();
    const closer = await rule(owner, workspace.id, {
      trigger: 'issue.status_changed',
      action: { kind: 'set_status', status: 'DONE' },
    });
    const id = await file(owner, workspace.id, project.id);
    await request(`/workspaces/${workspace.id}/issues/${id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'IN_PROGRESS' },
    });
    await drain();
    expect(await statusOf(id)).toBe('DONE');
    expect((await runsOf(closer)).map((r) => r.outcome).sort()).toEqual(['applied', 'own_change']);
  });

  test('a retried job applies its action once', async () => {
    const { owner, workspace, project } = await setUp();
    await rule(owner, workspace.id, {
      trigger: 'issue.created',
      action: { kind: 'comment', body: 'Thanks, someone will look today.' },
    });
    const id = await file(owner, workspace.id, project.id);
    const { db, ownerDb } = await getHarness();
    const [queued] = await ownerDb
      .select({ payload: jobs.payload })
      .from(jobs)
      .where(eq(jobs.kind, AUTOMATION_JOB));
    // Stored as text, as every job's payload is.
    const job = JSON.parse(queued!.payload) as Parameters<typeof evaluateAutomation>[1];
    // The same job, delivered three times.
    await evaluateAutomation(db, job);
    await evaluateAutomation(db, job);
    await evaluateAutomation(db, job);
    const posted = await ownerDb
      .select({ body: comments.body })
      .from(comments)
      .where(eq(comments.issueId, id));
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toContain('Posted by the automation “A rule”');
  });

  test('two rules setting each other off stop at the depth limit, with a note', async () => {
    const { owner, workspace, project } = await setUp();
    const forward = await rule(owner, workspace.id, {
      name: 'Forward',
      trigger: 'issue.status_changed',
      conditions: [{ field: 'status', op: 'is', value: 'TODO' }],
      action: { kind: 'set_status', status: 'IN_PROGRESS' },
    });
    const back = await rule(owner, workspace.id, {
      name: 'Back',
      trigger: 'issue.status_changed',
      conditions: [{ field: 'status', op: 'is', value: 'IN_PROGRESS' }],
      action: { kind: 'set_status', status: 'TODO' },
    });
    const id = await file(owner, workspace.id, project.id, { status: 'IN_REVIEW' });
    await request(`/workspaces/${workspace.id}/issues/${id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { status: 'TODO' },
    });
    await drain();
    const all = [...(await runsOf(forward)), ...(await runsOf(back))];
    const stopped = all.filter((r) => r.outcome === 'stopped');
    expect(stopped.length).toBeGreaterThan(0);
    expect(stopped[0]?.note).toContain('3 rules deep');
    expect(Math.max(...all.map((r) => r.depth))).toBe(3);
  });

  test('adding a label triggers its rules; re-saving the same labels does not', async () => {
    const { owner, workspace, project } = await setUp();
    const label = await request(`/workspaces/${workspace.id}/labels`, {
      method: 'POST',
      actor: owner,
      payload: { name: 'urgent', colour: 'rose' },
    });
    const labelId = label.json().label.id as string;
    const escalate = await rule(owner, workspace.id, {
      trigger: 'issue.label_added',
      conditions: [{ field: 'label', op: 'is', value: 'urgent' }],
      action: { kind: 'set_priority', priority: 'URGENT' },
    });
    const id = await file(owner, workspace.id, project.id);
    const put = () =>
      request(`/workspaces/${workspace.id}/issues/${id}/labels`, {
        method: 'PUT',
        actor: owner,
        payload: { labelIds: [labelId] },
      });
    await put();
    await put();
    await drain();
    expect((await runsOf(escalate)).map((r) => r.outcome)).toEqual(['applied']);
  });
});

describe('managing rules', () => {
  test('admins manage; members get 403, strangers 404; an assignee outside is refused', async () => {
    const { owner, workspace } = await setUp();
    const member = await createActor('Member');
    await addMember(owner, workspace.id, member, 'MEMBER');
    const stranger = await createActor('Stranger');
    const url = `/workspaces/${workspace.id}/automations`;
    expect((await request(url, { actor: member })).statusCode).toBe(403);
    expect((await request(url, { actor: stranger })).statusCode).toBe(404);
    const outside = await request(url, {
      method: 'POST',
      actor: owner,
      payload: {
        name: 'x',
        trigger: 'issue.created',
        action: { kind: 'assign', userId: stranger.id },
      },
    });
    expect(outside.statusCode).toBe(400);
    const id = await rule(owner, workspace.id, {
      trigger: 'issue.created',
      action: { kind: 'set_priority', priority: 'LOW' },
    });
    const off = await request(`${url}/${id}`, {
      method: 'PATCH',
      actor: owner,
      payload: { enabled: false },
    });
    expect(off.json().rule.enabled).toBe(false);
    expect((await request(`${url}/${id}`, { method: 'DELETE', actor: owner })).statusCode).toBe(
      204,
    );
  });

  test('a workspace with no rule listening queues no job', async () => {
    const { owner, workspace, project } = await setUp();
    await file(owner, workspace.id, project.id);
    const { ownerDb } = await getHarness();
    expect(await ownerDb.select().from(jobs).where(eq(jobs.kind, AUTOMATION_JOB))).toHaveLength(0);
  });
});

describe('telling someone or something else', () => {
  test('notify the reporter, and post to a channel, as the rule', async () => {
    const { owner, workspace, project } = await setUp();
    const { ownerDb } = await getHarness();
    const channels = (
      await request(`/workspaces/${workspace.id}/channels`, { actor: owner })
    ).json().channels as { id: string }[];
    await rule(owner, workspace.id, {
      name: 'Tell me',
      trigger: 'issue.created',
      action: { kind: 'notify', who: 'reporter', message: 'Your issue is in.' },
    });
    await rule(owner, workspace.id, {
      name: 'Announce',
      trigger: 'issue.created',
      action: { kind: 'post_to_channel', channelId: channels[0]!.id, body: 'A new issue came in' },
    });
    const id = await file(owner, workspace.id, project.id);
    await drain();
    const [notice] = await ownerDb
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, id));
    expect(notice?.kind).toBe('nudge');
    expect(notice?.userId).toBe(owner.id);
    const [posted] = await ownerDb
      .select({ body: messages.body })
      .from(messages)
      .where(eq(messages.channelId, channels[0]!.id));
    expect(posted?.body).toContain('by the automation “Announce”');
  });

  test('a webhook rule gets a secret it never chose, and its sending is queued for the worker', async () => {
    const { owner, workspace, project } = await setUp();
    const made = await request(`/workspaces/${workspace.id}/automations`, {
      method: 'POST',
      actor: owner,
      payload: {
        name: 'Hook',
        trigger: 'issue.created',
        action: { kind: 'webhook', url: 'https://hooks.example.com/robis', secret: 'chosen' },
      },
    });
    const secret = made.json().rule.action.secret as string;
    expect(secret).not.toBe('chosen');
    expect(secret.length).toBeGreaterThan(20);
    await file(owner, workspace.id, project.id);
    await drain();
    const { ownerDb } = await getHarness();
    expect(
      await ownerDb.select().from(jobs).where(eq(jobs.kind, AUTOMATION_WEBHOOK_JOB)),
    ).toHaveLength(1);
    const plain = await request(`/workspaces/${workspace.id}/automations`, {
      method: 'POST',
      actor: owner,
      payload: {
        name: 'Plain',
        trigger: 'issue.created',
        action: { kind: 'webhook', url: 'http://hooks.example.com' },
      },
    });
    expect(plain.statusCode).toBe(400);
  });

  test('the worker refuses private addresses; the signature is HMAC-SHA256 of the body', async () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '172.20.1.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPublicAddress(address)).toBe(false);
    }
    expect(isPublicAddress('93.184.216.34')).toBe(true);
    expect(isPublicAddress('2606:2800:220:1::1')).toBe(true);
    expect(await refusalFor('https://127.0.0.1/hook')).toBe(
      'it resolves to an address inside a private network',
    );
    expect(await refusalFor('https://[::1]/hook')).toBe(
      'it resolves to an address inside a private network',
    );
    expect(await refusalFor('http://93.184.216.34/hook')).toBe('only https on the default port');
    expect(await refusalFor('https://93.184.216.34:8443/hook')).toBe(
      'only https on the default port',
    );
    expect(signature('s3cret', '{"a":1}')).toBe(
      `sha256=${new Bun.CryptoHasher('sha256', 's3cret').update('{"a":1}').digest('hex')}`,
    );
  });

  test('a queued webhook to a private address fails the job, so it is retried and seen', async () => {
    const { owner, workspace, project } = await setUp();
    const made = await request(`/workspaces/${workspace.id}/automations`, {
      method: 'POST',
      actor: owner,
      payload: {
        name: 'Inside',
        trigger: 'issue.created',
        action: { kind: 'webhook', url: 'https://127.0.0.1/hook' },
      },
    });
    const id = await file(owner, workspace.id, project.id);
    const { workerDb } = await getHarness();
    await expect(
      sendWebhook(
        {
          ruleId: made.json().rule.id,
          workspaceId: workspace.id,
          eventId: crypto.randomUUID(),
          trigger: 'issue.created',
          issueId: id,
          issueKey: 'WEB-1',
        },
        { db: workerDb },
      ),
    ).rejects.toThrow('inside a private network');
  });
});
