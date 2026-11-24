import { createHash } from 'node:crypto';
import type { ImportedIssue, ImportProblem } from './model.ts';
import { PROBLEMS_KEPT, priorityFrom, sourceKey, statusFrom } from './model.ts';

/**
 * Issues from a CSV file (C6). The first row names the columns, in any
 * order and any case: `title` (needed), `description` or `body`, `status`
 * or `state`, `priority`, `labels` or `tags` (split on commas, semicolons
 * or bars), and `id`, `key` or `number` for the row's identity in the
 * source. Without an id, a row is known by its title and description, so a
 * rerun of the same file still creates nothing new.
 */

/** A field up to the next comma or line break, from `start`; and where it stopped. */
function plainField(source: string, start: number): [string, number] {
  let i = start;
  while (i < source.length && source[i] !== ',' && source[i] !== '\n' && source[i] !== '\r') i++;
  return [source.slice(start, i), i];
}

/** A quoted field from its opening quote: commas, line breaks and "" inside it are text. */
function quotedField(source: string, start: number): [string, number] {
  let field = '';
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === '"' && source[i + 1] === '"') {
      field += '"';
      i += 2;
    } else if (source[i] === '"') {
      const [rest, next] = plainField(source, i + 1);
      return [field + rest, next];
    } else {
      field += source[i];
      i++;
    }
  }
  return [field, i];
}

/** RFC 4180 rows: quoted fields may hold commas, quotes ("") and line breaks. */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  while (i < source.length) {
    const [field, next] = source[i] === '"' ? quotedField(source, i) : plainField(source, i);
    row.push(field);
    i = next;
    if (source[i] === ',') {
      i++;
      if (i === source.length) row.push('');
      continue;
    }
    rows.push(row);
    row = [];
    i += source[i] === '\r' && source[i + 1] === '\n' ? 2 : 1;
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const COLUMNS = {
  title: ['title', 'summary', 'name'],
  description: ['description', 'body', 'details'],
  status: ['status', 'state'],
  priority: ['priority'],
  labels: ['labels', 'label', 'tags'],
  id: ['id', 'key', 'number'],
} as const;

function columnIndex(header: string[], names: readonly string[]): number {
  return header.findIndex((cell) => names.includes(cell.trim().toLowerCase()));
}

const keyOf = (title: string, description: string) =>
  createHash('sha256').update(`${title}\n${description}`).digest('base64url').slice(0, 32);

export function csvIssues(text: string): { issues: ImportedIssue[]; problems: ImportProblem[] } {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { issues: [], problems: [{ row: 1, reason: 'The file is empty' }] };
  const at = Object.fromEntries(
    Object.entries(COLUMNS).map(([field, names]) => [field, columnIndex(header, names)]),
  ) as Record<keyof typeof COLUMNS, number>;
  if (at.title < 0) {
    return { issues: [], problems: [{ row: 1, reason: 'No title column in the first row' }] };
  }
  const cell = (row: string[], index: number) => (index < 0 ? '' : (row[index] ?? '').trim());
  const issues: ImportedIssue[] = [];
  const problems: ImportProblem[] = [];
  for (const [i, row] of rows.entries()) {
    const title = cell(row, at.title);
    const description = cell(row, at.description);
    if (!title) {
      if (problems.length < PROBLEMS_KEPT) problems.push({ row: i + 2, reason: 'No title' });
      continue;
    }
    const id = cell(row, at.id);
    issues.push({
      key: sourceKey('csv', id || keyOf(title, description)),
      title,
      description: description || null,
      status: statusFrom(cell(row, at.status)),
      priority: priorityFrom(cell(row, at.priority)),
      labels: cell(row, at.labels)
        .split(/[,;|]/)
        .map((name) => ({ name: name.trim(), colour: null }))
        .filter((label) => label.name),
      comments: [],
    });
  }
  return { issues, problems };
}
