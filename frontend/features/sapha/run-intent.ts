import { contracts, type SaphaIntent } from '@robis/shared';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { issueHref } from '../../lib/links.ts';
import { searchHref } from '../../lib/search-links.ts';
import { currentCycle } from '../cycles/use-cycles.ts';
import { releaseAsked } from './release-answer-model.ts';
import { findBoard, findNamed, findPerson, findTemplate } from './resolve.ts';

/**
 * Doing what a person said yes to (Sapha, tier 0): each change goes through
 * the same route its button uses, as that person, so their role decides
 * what is allowed and the audit log names them. Returns what to say, and
 * where the result is, or throws with a reason a person can act on.
 */

export type Done = { said: string; href: string | null };

type Change = Exclude<
  SaphaIntent,
  { kind: 'open' | 'search' | 'go' | 'blockers' | 'about' | 'cycle' | 'release' }
>;

async function issueByKey(workspaceId: string, key: string) {
  try {
    const { issue } = await call(contracts['issues.byKey'], { params: { workspaceId, key } });
    return issue;
  } catch {
    throw new Error(`No issue ${key} in this workspace.`);
  }
}

async function changeIssue(
  workspaceId: string,
  key: string,
  body: Record<string, unknown>,
  said: string,
): Promise<Done> {
  const issue = await issueByKey(workspaceId, key);
  await call(contracts['issues.update'], { params: { workspaceId, issueId: issue.id }, body });
  return { said, href: issueHref(workspaceId, issue.id) };
}

async function assign(
  workspaceId: string,
  intent: Extract<Change, { kind: 'assign' }>,
  myId: string | null,
) {
  const { members } = await call(contracts['members.list'], { params: { workspaceId } });
  const person = findPerson(members, intent.person, myId);
  if (!person.ok) throw new Error(person.reason);
  return changeIssue(
    workspaceId,
    intent.issueKey,
    { assigneeId: person.value.userId },
    `${intent.issueKey} is ${person.value.userId === myId ? 'yours' : `with ${person.value.name}`}.`,
  );
}

async function create(workspaceId: string, intent: Extract<Change, { kind: 'create' }>) {
  const { projects } = await call(contracts['projects.list'], { params: { workspaceId } });
  const board = findBoard(projects, intent.board);
  if (!board.ok) throw new Error(board.reason);
  const { issue } = await call(contracts['issues.create'], {
    params: { workspaceId, projectId: board.value.id },
    body: { title: intent.title },
  });
  return { said: `Made it on ${board.value.name}.`, href: issueHref(workspaceId, issue.id) };
}

async function fileFromTemplate(
  workspaceId: string,
  intent: Extract<Change, { kind: 'template' }>,
) {
  const [{ templates }, { projects }] = await Promise.all([
    call(contracts['issueTemplates.list'], { params: { workspaceId } }),
    call(contracts['projects.list'], { params: { workspaceId } }),
  ]);
  const template = findTemplate(templates, intent.template);
  if (!template.ok) throw new Error(template.reason);
  const board = findBoard(projects, intent.board);
  if (!board.ok) throw new Error(board.reason);
  const { issue } = await call(contracts['issueTemplates.file'], {
    params: { workspaceId, templateId: template.value.id },
    body: { projectId: board.value.id, ...(intent.title ? { title: intent.title } : {}) },
  });
  return {
    said: `Filed ${issue.key} from ${template.value.name} on ${board.value.name}.`,
    href: issueHref(workspaceId, issue.id),
  };
}

/** The cycle an issue goes in: one of its board's by name, else the running or next one. */
async function cycleFor(workspaceId: string, projectId: string, name: string | null) {
  const { cycles } = await call(contracts['cycles.list'], { params: { workspaceId, projectId } });
  if (name) {
    const found = findNamed(cycles, name, 'cycle on its board');
    if (!found.ok) throw new Error(found.reason);
    return found.value;
  }
  const cycle = currentCycle(cycles, localToday());
  if (!cycle) throw new Error('Its board has no cycle running or planned. Plan one on the board.');
  return cycle;
}

/** The release an issue goes in: one still to ship by name, else the next. */
async function releaseFor(workspaceId: string, name: string | null) {
  const { releases } = await call(contracts['releases.list'], { params: { workspaceId } });
  const open = releases.filter((release) => !release.shippedAt);
  if (name) {
    const found = findNamed(open, name, 'release still to ship');
    if (!found.ok) throw new Error(found.reason);
    return found.value;
  }
  const next = releaseAsked(open, null);
  if (!next) throw new Error('No release is waiting to ship. Plan one on Releases.');
  return next;
}

async function plan(workspaceId: string, intent: Extract<Change, { kind: 'plan' }>) {
  const issue = await issueByKey(workspaceId, intent.issueKey);
  const target =
    intent.into === 'cycle'
      ? await cycleFor(workspaceId, issue.projectId, intent.name)
      : await releaseFor(workspaceId, intent.name);
  const body = intent.into === 'cycle' ? { cycleId: target.id } : { releaseId: target.id };
  return changeIssue(
    workspaceId,
    intent.issueKey,
    body,
    `${intent.issueKey} is in ${target.name}.`,
  );
}

async function remind(workspaceId: string, intent: Extract<Change, { kind: 'remind' }>) {
  const issue = await issueByKey(workspaceId, intent.issueKey);
  await call(contracts['reminders.create'], {
    params: { workspaceId },
    body: { about: 'issue', id: issue.id, at: intent.at },
  });
  return { said: 'Reminder set. It waits under Later in your inbox.', href: null };
}

async function schedule(workspaceId: string, intent: Extract<Change, { kind: 'schedule' }>) {
  await call(contracts['meetings.create'], {
    params: { workspaceId },
    body: { title: intent.title, startsAt: intent.at },
  });
  return {
    said: 'Scheduled. Invite people from Meetings.',
    href: `/workspaces/${workspaceId}/meetings`,
  };
}

export function runIntent(workspaceId: string, intent: Change, myId: string | null): Promise<Done> {
  switch (intent.kind) {
    case 'status':
      return changeIssue(workspaceId, intent.issueKey, { status: intent.status }, 'Moved.');
    case 'priority':
      return changeIssue(workspaceId, intent.issueKey, { priority: intent.priority }, 'Changed.');
    case 'due':
      return changeIssue(
        workspaceId,
        intent.issueKey,
        { dueOn: intent.dueOn },
        intent.dueOn ? 'Due day set.' : 'Due day cleared.',
      );
    case 'unassign':
      return changeIssue(workspaceId, intent.issueKey, { assigneeId: null }, 'Unassigned.');
    case 'assign':
      return assign(workspaceId, intent, myId);
    case 'create':
      return create(workspaceId, intent);
    case 'template':
      return fileFromTemplate(workspaceId, intent);
    case 'plan':
      return plan(workspaceId, intent);
    case 'unplan':
      return changeIssue(
        workspaceId,
        intent.issueKey,
        intent.from === 'cycle' ? { cycleId: null } : { releaseId: null },
        `${intent.issueKey} is out of its ${intent.from}.`,
      );
    case 'remind':
      return remind(workspaceId, intent);
    case 'schedule':
      return schedule(workspaceId, intent);
  }
}

/** Where a looking intent goes; an issue key is looked up first. */
export async function placeOf(
  workspaceId: string,
  intent: Extract<SaphaIntent, { kind: 'open' | 'search' | 'go' | 'blockers' | 'about' }>,
): Promise<string> {
  const base = `/workspaces/${workspaceId}`;
  // A question about an issue opens it, where its Blocked by answers it.
  if (intent.kind === 'open' || intent.kind === 'blockers' || intent.kind === 'about')
    return issueHref(workspaceId, (await issueByKey(workspaceId, intent.issueKey)).id);
  if (intent.kind === 'search') return searchHref(workspaceId, intent.query);
  const places = {
    day: `${base}/feed`,
    calendar: `${base}/calendar`,
    feed: `${base}/feed`,
    spaces: `${base}/spaces`,
    meetings: `${base}/meetings`,
  } as const;
  return places[intent.place];
}
