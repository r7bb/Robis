import { type Executor, issues, type Tx } from '@robis/database';
import { and, asc, eq, sql } from 'drizzle-orm';
import { ApiError } from '../errors.ts';

/**
 * Sub-issues (C1): an issue may be part of another in the same project,
 * never of itself or of its own descendant. Each change of parent takes the
 * project's tree lock first, so two moves at once cannot make a loop
 * between them that neither would have made alone.
 */

/**
 * How many issues deep a tree may go. Far past any real plan; it also
 * bounds the walk up, and a walk that has not reached the top within it is
 * refused, so no chain is ever too long to check for a loop.
 */
const MAX_DEPTH = 50;

/** How many sub-issues an issue's page lists. */
const CHILDREN_SHOWN = 200;

type ParentCheck = {
  workspaceId: string;
  projectId: string;
  issueId: string | null;
  parentId: string;
};

/**
 * Check `parentId` may be the parent of `issueId` (null when the issue is
 * still being made), in the caller's transaction. The parent row is held
 * until the transaction ends, so it cannot be deleted between the check
 * and the write.
 */
export async function assertParentAllowed(tx: Tx, check: ParentCheck) {
  const { workspaceId, projectId, issueId, parentId } = check;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`issue-tree:${projectId}`}))`);
  if (parentId === issueId) {
    throw ApiError.badRequest('An issue cannot be part of itself', 'parent_cycle');
  }

  const [parent] = await tx
    .select({ projectId: issues.projectId })
    .from(issues)
    .where(and(eq(issues.id, parentId), eq(issues.workspaceId, workspaceId)))
    .for('share');
  if (!parent) throw ApiError.badRequest('The parent is not an issue here', 'bad_parent');
  if (parent.projectId !== projectId) {
    throw ApiError.badRequest('A sub-issue stays in its parent’s project', 'parent_other_project');
  }

  const walk = await walkUp(tx, check);
  if (walk.cycle) {
    throw ApiError.badRequest('That issue is already part of this one', 'parent_cycle');
  }
  if (!walk.rooted) {
    throw ApiError.badRequest(`Sub-issues go at most ${MAX_DEPTH} deep`, 'parent_too_deep');
  }
}

/**
 * Walk up from the would-be parent, at most `MAX_DEPTH` steps: meeting the
 * issue itself means the parent is one of its own descendants, and not
 * reaching the top means the tree would be too deep.
 */
async function walkUp(tx: Tx, { workspaceId, issueId, parentId }: ParentCheck) {
  const [walk] = await tx.execute<{ cycle: boolean; rooted: boolean }>(sql`
    with recursive up(id, parent_id, depth) as (
      select id, parent_id, 1 from issues where id = ${parentId} and workspace_id = ${workspaceId}
      union all
      select i.id, i.parent_id, up.depth + 1
        from issues i join up on i.id = up.parent_id
       where up.depth < ${MAX_DEPTH}
    )
    select exists (select 1 from up where id = ${issueId ?? null}::uuid) as cycle,
           exists (select 1 from up where parent_id is null and depth < ${MAX_DEPTH}) as rooted
  `);
  return { cycle: Boolean(walk?.cycle), rooted: Boolean(walk?.rooted) };
}

/** A parent or sub-issue, as its relative's page shows it. */
type Relative = {
  id: string;
  key: string;
  title: string;
  status: (typeof issues.$inferSelect)['status'];
};

/** An issue's parent and sub-issues, keyed with its project's key. */
export async function loadRelatives(
  db: Executor,
  {
    workspaceId,
    issueId,
    parentId,
    projectKey,
  }: {
    workspaceId: string;
    issueId: string;
    parentId: string | null;
    projectKey: string;
  },
): Promise<{ parent: Relative | null; children: Relative[] }> {
  const columns = {
    id: issues.id,
    number: issues.number,
    title: issues.title,
    status: issues.status,
  };
  const withKey = (row: {
    id: string;
    number: number;
    title: string;
    status: Relative['status'];
  }) => ({
    id: row.id,
    key: `${projectKey}-${row.number}`,
    title: row.title,
    status: row.status,
  });

  const [parent] = parentId
    ? await db
        .select(columns)
        .from(issues)
        .where(and(eq(issues.id, parentId), eq(issues.workspaceId, workspaceId)))
    : [];
  const children = await db
    .select(columns)
    .from(issues)
    .where(and(eq(issues.parentId, issueId), eq(issues.workspaceId, workspaceId)))
    .orderBy(asc(issues.number))
    .limit(CHILDREN_SHOWN);

  return { parent: parent ? withKey(parent) : null, children: children.map(withKey) };
}
