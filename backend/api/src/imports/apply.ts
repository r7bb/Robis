import {
  type AuditActor,
  comments,
  type Database,
  issueImports,
  issueLabels,
  labels,
  recordAudit,
  type Tx,
} from '@robis/database';
import { ISSUE_LABELS_MAX, LABEL_COLOURS } from '@robis/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ApiError } from '../errors.ts';
import { fileIssue } from '../routes/issues.ts';
import { IMPORT_MAX_ISSUES, type ImportedIssue } from './model.ts';

/**
 * Put imported issues on a board (C6), all in one transaction, so an import
 * lands whole or not at all. An issue whose source key this project has
 * seen before is skipped, so running the same import again creates
 * nothing; labels are matched by name, ignoring case, and made when
 * missing. Each issue is filed the way the board files one, so it is
 * audited and numbered like any other; the import itself is one more
 * entry in the trail.
 */

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;
const COMMENT_MAX = 10_000;
const LABEL_MAX = 40;
/** New labels one import may make; a source with more is refused, not half taken. */
const NEW_LABELS_MAX = 100;
const COMMENTS_PER_ISSUE = 200;
const COMMENTS_PER_IMPORT = 10_000;
/** Rows per insert, well inside Postgres's limit on bound values. */
const CHUNK = 500;

export type ImportResult = {
  found: number;
  created: number;
  skipped: number;
  labelsCreated: number;
  comments: number;
};

type Owner = { id: string; kind: string };

/** Label ids by lower-case name, made where the workspace has none of that name. */
async function labelIds(tx: Tx, workspaceId: string, wanted: ImportedIssue['labels']) {
  const byName = new Map<string, ImportedIssue['labels'][number]>();
  for (const label of wanted) {
    const name = label.name.slice(0, LABEL_MAX).trim();
    if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { ...label, name });
  }
  if (byName.size === 0) return { ids: new Map<string, string>(), made: 0 };
  const have = await tx
    .select({ id: labels.id, name: labels.name })
    .from(labels)
    .where(
      and(
        eq(labels.workspaceId, workspaceId),
        inArray(sql`lower(${labels.name})`, [...byName.keys()]),
      ),
    );
  const ids = new Map(have.map((label) => [label.name.toLowerCase(), label.id]));
  const missing = [...byName].filter(([lower]) => !ids.has(lower));
  if (missing.length > NEW_LABELS_MAX) {
    throw ApiError.badRequest(
      `That would make ${missing.length} new labels; an import makes at most ${NEW_LABELS_MAX}.`,
      'import_too_many_labels',
    );
  }
  let made = 0;
  for (const [lower, label] of missing) {
    const colour = label.colour ?? LABEL_COLOURS[made % LABEL_COLOURS.length]!;
    // Someone may make the same label meanwhile: keep theirs rather than fail.
    const [row] = await tx
      .insert(labels)
      .values({ workspaceId, name: label.name, colour })
      .onConflictDoNothing()
      .returning({ id: labels.id });
    if (row) {
      ids.set(lower, row.id);
      made++;
      continue;
    }
    const [theirs] = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.workspaceId, workspaceId), eq(sql`lower(${labels.name})`, lower)));
    if (theirs) ids.set(lower, theirs.id);
  }
  return { ids, made };
}

/** The issues this project has not imported before, each once. */
async function freshIssues(tx: Tx, projectId: string, issues: ImportedIssue[]) {
  const keys = [...new Set(issues.map((issue) => issue.key))];
  const rows =
    keys.length === 0
      ? []
      : await tx
          .select({ key: issueImports.sourceKey })
          .from(issueImports)
          .where(and(eq(issueImports.projectId, projectId), inArray(issueImports.sourceKey, keys)));
  const seen = new Set(rows.map((row) => row.key));
  return issues.filter((issue) => {
    if (seen.has(issue.key)) return false;
    seen.add(issue.key);
    return true;
  });
}

type Target = {
  workspaceId: string;
  projectId: string;
  owner: Owner;
  labelIds: Map<string, string>;
};

/** File one issue with its labels and comments; how many comments it brought. */
async function fileOne(tx: Tx, actor: AuditActor, target: Target, issue: ImportedIssue) {
  const { workspaceId, projectId, owner } = target;
  const created = await fileIssue(tx, actor, {
    user: owner,
    workspaceId,
    projectId,
    input: {
      title: issue.title.slice(0, TITLE_MAX),
      ...(issue.description ? { description: issue.description.slice(0, DESCRIPTION_MAX) } : {}),
      status: issue.status,
      priority: issue.priority,
    },
  });
  await tx
    .insert(issueImports)
    .values({ projectId, sourceKey: issue.key, issueId: created.id, workspaceId });
  const labelRows = [
    ...new Set(
      issue.labels.map((l) => target.labelIds.get(l.name.slice(0, LABEL_MAX).trim().toLowerCase())),
    ),
  ]
    .flatMap((labelId) => (labelId ? [{ issueId: created.id, labelId, workspaceId }] : []))
    .slice(0, ISSUE_LABELS_MAX);
  if (labelRows.length > 0) await tx.insert(issueLabels).values(labelRows);
  const bodies = issue.comments
    .map((body) => body.trim().slice(0, COMMENT_MAX))
    .filter(Boolean)
    .slice(0, COMMENTS_PER_ISSUE);
  // A millisecond apart, so they read in the source's order.
  const started = Date.now();
  for (let at = 0; at < bodies.length; at += CHUNK) {
    await tx.insert(comments).values(
      bodies.slice(at, at + CHUNK).map((body, i) => ({
        workspaceId,
        issueId: created.id,
        authorId: owner.id,
        body,
        createdAt: new Date(started + at + i),
      })),
    );
  }
  return bodies.length;
}

export async function applyImport(
  db: Database,
  actor: AuditActor,
  owner: Owner,
  input: { workspaceId: string; projectId: string; source: string; issues: ImportedIssue[] },
): Promise<ImportResult> {
  const { workspaceId, projectId, source, issues } = input;
  const commentTotal = issues.reduce(
    (sum, issue) => sum + Math.min(issue.comments.length, COMMENTS_PER_ISSUE),
    0,
  );
  if (commentTotal > COMMENTS_PER_IMPORT) {
    throw ApiError.badRequest(
      `An import takes at most ${COMMENTS_PER_IMPORT} comments; split the source.`,
      'import_too_large',
    );
  }
  if (issues.length > IMPORT_MAX_ISSUES) {
    throw ApiError.badRequest(
      `An import takes at most ${IMPORT_MAX_ISSUES} issues; split the file.`,
      'import_too_large',
    );
  }
  return db.transaction(async (tx) => {
    // One import into a project at a time, so two runs of one file cannot both see it as new.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`import:${projectId}`}))`);
    const fresh = await freshIssues(tx, projectId, issues);
    const { ids, made } = await labelIds(
      tx,
      workspaceId,
      fresh.flatMap((issue) => issue.labels),
    );
    const target = { workspaceId, projectId, owner, labelIds: ids };
    let commentCount = 0;
    // Last first, so the board reads them in the source's order from the top.
    for (const issue of [...fresh].reverse())
      commentCount += await fileOne(tx, actor, target, issue);

    const result = {
      found: issues.length,
      created: fresh.length,
      skipped: issues.length - fresh.length,
      labelsCreated: made,
      comments: commentCount,
    };
    await recordAudit(tx, actor, {
      workspaceId,
      entityType: 'project',
      entityId: projectId,
      eventType: 'issues.imported',
      payload: { source, ...result },
    });
    return result;
  });
}
