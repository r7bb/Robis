import {
  comments,
  cycles,
  type Database,
  issueBlocks,
  issues,
  projects,
  releases,
  users,
  workspaceMembers,
} from '@robis/database';
import {
  describeIntent,
  intentFromParts,
  LOOKING_INTENTS,
  partsOfProposal,
  SAPHA_TOOLS,
  type SaphaCited,
  type SaphaParts,
  type SaphaToolName,
} from '@robis/shared';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

/**
 * What Sapha may look at (the agent): each tool reads inside one workspace,
 * for one person who may read its issues, and says what it found in a few
 * plain lines. What it returns is data from the workspace, quoted to the
 * model as such; `propose` checks a change and keeps it for the person to
 * say yes to, and nothing here writes.
 */

export type ToolScope = { workspaceId: string; userId: string; now: Date };

export type ToolOutcome = {
  text: string;
  isError: boolean;
  /** How the step is said to the person: "Looked at REL-4". */
  label: string | null;
  cited: SaphaCited[];
  proposal: SaphaParts | null;
};

/** Issues one search returns, and people one list returns. */
const LISTED = 10;
const PEOPLE_LISTED = 20;
/** Comments read with an issue, and how much of each. */
const COMMENTS_READ = 5;
const COMMENT_CHARS = 400;
const DESCRIPTION_CHARS = 1500;
const FINISHED = ['DONE', 'CANCELED'] as const;
const KEY = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d{1,9})$/;

const keyOf = sql<string>`${projects.key} || '-' || ${issues.number}`;
const assignee = alias(users, 'assignee');

const outcome = (text: string, fields: Partial<Omit<ToolOutcome, 'text'>> = {}): ToolOutcome => ({
  text,
  isError: false,
  label: null,
  cited: [],
  proposal: null,
  ...fields,
});
const failed = (text: string): ToolOutcome => outcome(text, { isError: true });

/** Text the model gave, as a LIKE pattern that matches it literally. */
const like = (words: string) => `%${words.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** A board by its key exactly, else by its name, as a filter on projects. */
const onBoard = (board: string) =>
  or(eq(sql`upper(${projects.key})`, board.toUpperCase()), ilike(projects.name, like(board)));

type Row = {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  dueOn: string | null;
  assigneeName: string | null;
};

const lineOf = (row: Row) =>
  [
    row.key,
    row.title,
    row.status,
    row.priority === 'NONE' ? null : `${row.priority.toLowerCase()} priority`,
    row.assigneeName ? `with ${row.assigneeName}` : 'unassigned',
    row.dueOn ? `due ${row.dueOn}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

const cite = (rows: readonly Row[]): SaphaCited[] =>
  rows.map(({ id, key, title }) => ({ id, key, title }));

/** Issues as one line each; every caller filters to its workspace. */
function listed(db: Database) {
  return db
    .select({
      id: issues.id,
      key: keyOf,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      dueOn: issues.dueOn,
      assigneeName: assignee.name,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(assignee, eq(assignee.id, issues.assigneeId))
    .$dynamic();
}

async function searchIssues(db: Database, scope: ToolScope, input: Input<'search_issues'>) {
  const filters = [eq(issues.workspaceId, scope.workspaceId)];
  if (input.query) {
    filters.push(
      or(ilike(issues.title, like(input.query)), ilike(issues.description, like(input.query)))!,
    );
  }
  if (input.board) filters.push(onBoard(input.board)!);
  if (input.status) filters.push(eq(issues.status, input.status));
  const rows = await listed(db)
    .where(and(...filters))
    .orderBy(desc(issues.updatedAt))
    .limit(LISTED);
  const label = input.query ? `Searched for “${input.query}”` : 'Looked through the issues';
  if (rows.length === 0) return outcome('No issue matches.', { label });
  return outcome(rows.map(lineOf).join('\n'), { label, cited: cite(rows) });
}

async function getIssue(db: Database, scope: ToolScope, input: Input<'get_issue'>) {
  const key = KEY.exec(input.key);
  if (!key) return failed('That is not an issue key; keys look like REL-12.');
  const [found] = await db
    .select({
      id: issues.id,
      key: keyOf,
      title: issues.title,
      status: issues.status,
      priority: issues.priority,
      dueOn: issues.dueOn,
      assigneeName: assignee.name,
      description: issues.description,
      carriedOver: issues.carriedOver,
      cycle: cycles.name,
      release: releases.name,
    })
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(assignee, eq(assignee.id, issues.assigneeId))
    .leftJoin(cycles, eq(cycles.id, issues.cycleId))
    .leftJoin(releases, eq(releases.id, issues.releaseId))
    .where(
      and(
        eq(issues.workspaceId, scope.workspaceId),
        eq(sql`upper(${projects.key})`, key[1]!.toUpperCase()),
        eq(issues.number, Number(key[2])),
      ),
    );
  if (!found) return failed(`No issue ${input.key.toUpperCase()} in this workspace.`);
  const [waitsOn, said] = await Promise.all([
    blockersOf(db, scope, found.id),
    commentsOn(db, found.id),
  ]);
  const lines = [
    lineOf(found),
    found.cycle
      ? `In the cycle ${found.cycle}${found.carriedOver > 0 ? `, carried on ${found.carriedOver} time(s)` : ''}`
      : 'In no cycle',
    found.release ? `In the release ${found.release}` : null,
    found.description
      ? `Description: ${found.description.slice(0, DESCRIPTION_CHARS)}`
      : 'No description',
    waitsOn.length > 0 ? `Waits on: ${waitsOn.map(lineOf).join('; ')}` : null,
    ...said.map((c) => `Comment by ${c.author}: ${c.body.slice(0, COMMENT_CHARS)}`),
  ].filter(Boolean);
  return outcome(lines.join('\n'), {
    label: `Looked at ${found.key}`,
    cited: cite([found, ...waitsOn]),
  });
}

/** What an issue still waits on: its blockers not yet finished. */
function blockersOf(db: Database, scope: ToolScope, issueId: string) {
  const blocking = db
    .select({ id: issueBlocks.blockerId })
    .from(issueBlocks)
    .where(and(eq(issueBlocks.blockedId, issueId), eq(issueBlocks.workspaceId, scope.workspaceId)));
  return listed(db).where(
    and(
      eq(issues.workspaceId, scope.workspaceId),
      inArray(issues.id, blocking),
      notInArray(issues.status, [...FINISHED]),
    ),
  );
}

async function commentsOn(db: Database, issueId: string) {
  const rows = await db
    .select({ author: users.name, body: comments.body })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.issueId, issueId))
    .orderBy(desc(comments.createdAt))
    .limit(COMMENTS_READ);
  return rows.reverse();
}

async function runningCycles(db: Database, scope: ToolScope, input: Input<'running_cycles'>) {
  const today = scope.now.toISOString().slice(0, 10);
  const rows = await db
    .select({
      name: cycles.name,
      board: projects.name,
      endsOn: cycles.endsOn,
      counted: sql<number>`(count(${issues.id}) filter (where ${issues.status} <> 'CANCELED'))::int`,
      done: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'DONE'))::int`,
      carried: sql<number>`(count(${issues.id}) filter (where ${issues.carriedOver} > 0 and ${issues.status} not in ('DONE', 'CANCELED')))::int`,
    })
    .from(cycles)
    .innerJoin(projects, eq(projects.id, cycles.projectId))
    .leftJoin(issues, eq(issues.cycleId, cycles.id))
    .where(
      and(
        eq(cycles.workspaceId, scope.workspaceId),
        eq(projects.archived, false),
        lte(cycles.startsOn, today),
        gte(cycles.endsOn, today),
        input.board ? onBoard(input.board) : undefined,
      ),
    )
    .groupBy(cycles.id, projects.id)
    .orderBy(asc(projects.name));
  const label = input.board
    ? `Looked at the cycle on ${input.board}`
    : 'Looked at the running cycles';
  if (rows.length === 0) return outcome('No cycle is running today.', { label });
  const text = rows
    .map(
      (c) =>
        `${c.name} on ${c.board}: ${c.done} of ${c.counted} done, ends ${c.endsOn}, ${c.carried} open issue(s) carried on from earlier cycles`,
    )
    .join('\n');
  return outcome(text, { label });
}

async function releaseList(db: Database, scope: ToolScope) {
  const rows = await db
    .select({
      name: releases.name,
      targetOn: releases.targetOn,
      shippedAt: releases.shippedAt,
      counted: sql<number>`(count(${issues.id}) filter (where ${issues.status} <> 'CANCELED'))::int`,
      done: sql<number>`(count(${issues.id}) filter (where ${issues.status} = 'DONE'))::int`,
    })
    .from(releases)
    .leftJoin(issues, eq(issues.releaseId, releases.id))
    .where(eq(releases.workspaceId, scope.workspaceId))
    .groupBy(releases.id)
    .orderBy(sql`${releases.shippedAt} is not null`, asc(releases.targetOn));
  const label = 'Looked at the releases';
  if (rows.length === 0) return outcome('No releases are planned.', { label });
  const text = rows
    .map((r) => {
      const when = r.shippedAt
        ? `shipped ${new Date(r.shippedAt).toISOString().slice(0, 10)}`
        : r.targetOn
          ? `aimed at ${r.targetOn}`
          : 'no day set';
      return `${r.name}: ${r.done} of ${r.counted} done, ${when}`;
    })
    .join('\n');
  return outcome(text, { label });
}

async function myWork(db: Database, scope: ToolScope) {
  const rows = await listed(db)
    .where(
      and(
        eq(issues.workspaceId, scope.workspaceId),
        eq(issues.assigneeId, scope.userId),
        notInArray(issues.status, [...FINISHED]),
      ),
    )
    .orderBy(sql`${issues.dueOn} asc nulls last`, desc(issues.updatedAt))
    .limit(LISTED * 2);
  const label = 'Looked at your work';
  if (rows.length === 0)
    return outcome('Nothing open is assigned to the person asking.', { label });
  return outcome(rows.map(lineOf).join('\n'), { label, cited: cite(rows) });
}

async function people(db: Database, scope: ToolScope, input: Input<'people'>) {
  const rows = await db
    .select({ name: users.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, scope.workspaceId),
        eq(users.kind, 'human'),
        isNull(users.deletedAt),
        input.name ? ilike(users.name, like(input.name)) : undefined,
      ),
    )
    .orderBy(asc(users.name))
    .limit(PEOPLE_LISTED);
  const label = 'Looked at the people here';
  if (rows.length === 0) return outcome('No one here by that name.', { label });
  return outcome(rows.map((p) => `${p.name} (${p.role.toLowerCase()})`).join('\n'), { label });
}

/** A change checked as a typed request would be, and kept for a yes; never made. */
function propose(scope: ToolScope, parts: SaphaParts): ToolOutcome {
  const intent = intentFromParts(parts, scope.now);
  if (!intent) return failed('Those parts do not make a change Sapha can propose; check them.');
  if (LOOKING_INTENTS.has(intent.kind)) {
    return failed('Only changes are proposed. Answer questions yourself, after looking.');
  }
  const said = describeIntent(intent, scope.now);
  return outcome(`Proposed, waiting for the person’s yes: ${said}`, {
    label: `Proposed: ${said}`,
    proposal: parts,
  });
}

type Input<N extends SaphaToolName> = ReturnType<(typeof SAPHA_TOOLS)[N]['input']['parse']>;

/** Run one tool the model asked for, its input checked first; a failure is said, not thrown. */
export async function runTool(
  db: Database,
  scope: ToolScope,
  name: string,
  raw: unknown,
): Promise<ToolOutcome> {
  if (!Object.hasOwn(SAPHA_TOOLS, name)) return failed(`There is no tool called ${name}.`);
  const tool = name as SaphaToolName;
  const checked = SAPHA_TOOLS[tool].input.safeParse(raw ?? {});
  if (!checked.success)
    return failed(`The input to ${name} does not hold: ${checked.error.message}`);
  try {
    return await run(db, scope, tool, checked.data as never);
  } catch {
    // A lookup that failed is said to the model, so it can answer without it.
    return failed(`Looking that up failed just now: ${name} could not be read.`);
  }
}

function run(
  db: Database,
  scope: ToolScope,
  tool: SaphaToolName,
  input: never,
): Promise<ToolOutcome> | ToolOutcome {
  switch (tool) {
    case 'search_issues':
      return searchIssues(db, scope, input);
    case 'get_issue':
      return getIssue(db, scope, input);
    case 'running_cycles':
      return runningCycles(db, scope, input);
    case 'releases':
      return releaseList(db, scope);
    case 'my_work':
      return myWork(db, scope);
    case 'people':
      return people(db, scope, input);
    case 'propose':
      return propose(scope, partsOfProposal(input));
  }
}
