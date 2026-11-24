import { contracts, type SaphaIntent } from '@robis/shared';
import { call } from '../../lib/api.ts';
import { issueHref } from '../../lib/links.ts';
import { searchHref } from '../../lib/search-links.ts';
import { findBoard, findPerson } from './resolve.ts';

/**
 * Doing what a person said yes to (Sapha, tier 0): each change goes through
 * the same route its button uses, as that person, so their role decides
 * what is allowed and the audit log names them. Returns what to say, and
 * where the result is, or throws with a reason a person can act on.
 */

export type Done = { said: string; href: string | null };

type Change = Exclude<SaphaIntent, { kind: 'open' | 'search' | 'go' }>;

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
    case 'remind':
      return remind(workspaceId, intent);
    case 'schedule':
      return schedule(workspaceId, intent);
  }
}

/** Where a looking intent goes; an issue key is looked up first. */
export async function placeOf(
  workspaceId: string,
  intent: Extract<SaphaIntent, { kind: 'open' | 'search' | 'go' }>,
): Promise<string> {
  const base = `/workspaces/${workspaceId}`;
  if (intent.kind === 'open')
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
