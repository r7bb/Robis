import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '@robis/shared';
import { readZip, ZipError } from '@robis/storage';
import { z } from 'zod';
import {
  colourFrom,
  type ImportedIssue,
  type ImportProblem,
  PROBLEMS_KEPT,
  sourceKey,
} from './model.ts';

/**
 * Issues from a Robis workspace export (C6): every issue in it, with its
 * labels and comments, keyed by the workspace and issue it came from, so
 * importing the same export twice creates nothing new. Lines that do not
 * read as what they should be are reported, not guessed at.
 */

/** The most content one export may unpack to, as read for import. */
const ROBIS_IMPORT_MAX_BYTES = 64 * 1024 * 1024;

const manifest = z.object({
  format: z.literal('robis-export'),
  version: z.literal(1),
  workspace: z.object({ id: z.string() }),
});
const issueLine = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).nullable().optional(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.enum(ISSUE_PRIORITIES),
  createdAt: z.string().optional(),
});
const labelLine = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(40),
  colour: z.unknown(),
});
const issueLabelLine = z.object({ issueId: z.string(), labelId: z.string() });
const commentLine = z.object({
  issueId: z.string(),
  body: z.string().min(1),
  createdAt: z.string().optional(),
});

export class NotAnExport extends Error {}

function lines<T>(
  files: Map<string, string>,
  name: string,
  schema: z.ZodType<T>,
  problems: ImportProblem[],
): T[] {
  const text = files.get(name) ?? '';
  const out: T[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      if (problems.length < PROBLEMS_KEPT)
        problems.push({ row: i + 1, reason: `${name}: not JSON` });
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) out.push(parsed.data);
    else if (problems.length < PROBLEMS_KEPT)
      problems.push({
        row: i + 1,
        reason: `${name}: ${parsed.error.issues[0]?.message ?? 'unreadable'}`,
      });
  }
  return out;
}

export function robisIssues(archive: Uint8Array): {
  issues: ImportedIssue[];
  problems: ImportProblem[];
} {
  let entries: ReturnType<typeof readZip>;
  try {
    entries = readZip(archive, ROBIS_IMPORT_MAX_BYTES);
  } catch (error) {
    if (error instanceof ZipError) throw new NotAnExport(error.message);
    throw error;
  }
  const decoder = new TextDecoder();
  const files = new Map(
    entries
      .filter((e) => e.name.endsWith('.json') || e.name.endsWith('.jsonl'))
      .map((e) => [e.name, decoder.decode(e.data)]),
  );
  let head: z.infer<typeof manifest>;
  try {
    head = manifest.parse(JSON.parse(files.get('manifest.json') ?? 'null'));
  } catch {
    throw new NotAnExport('That zip is not a Robis workspace export');
  }

  const problems: ImportProblem[] = [];
  const labelsById = new Map(
    lines(files, 'labels.jsonl', labelLine, problems).map((l) => [
      l.id,
      { name: l.name, colour: colourFrom(l.colour) },
    ]),
  );
  const labelsOf = new Map<string, ImportedIssue['labels']>();
  for (const link of lines(files, 'issue-labels.jsonl', issueLabelLine, problems)) {
    const label = labelsById.get(link.labelId);
    if (label) labelsOf.set(link.issueId, [...(labelsOf.get(link.issueId) ?? []), label]);
  }
  const commentsOf = new Map<string, { body: string; at: string }[]>();
  for (const comment of lines(files, 'comments.jsonl', commentLine, problems)) {
    const list = commentsOf.get(comment.issueId) ?? [];
    list.push({ body: comment.body, at: comment.createdAt ?? '' });
    commentsOf.set(comment.issueId, list);
  }

  const issues = lines(files, 'issues.jsonl', issueLine, problems)
    .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))
    .map((issue) => ({
      key: sourceKey('robis', `${head.workspace.id}:${issue.id}`),
      title: issue.title,
      description: issue.description ?? null,
      status: issue.status,
      priority: issue.priority,
      labels: labelsOf.get(issue.id) ?? [],
      comments: (commentsOf.get(issue.id) ?? [])
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((c) => c.body),
    }));
  return { issues, problems };
}
