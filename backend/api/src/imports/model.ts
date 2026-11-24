import { createHash } from 'node:crypto';
import {
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  type IssuePriority,
  type IssueStatus,
  LABEL_COLOURS,
  type LabelColour,
} from '@robis/shared';

/**
 * An issue on its way in (C6), whatever it came from: its key in the
 * source, so a rerun can recognise it, and what it carries. Comments come
 * in as their text alone; authors in the source are not people here.
 */
export type ImportedIssue = {
  key: string;
  title: string;
  description: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  labels: { name: string; colour: LabelColour | null }[];
  comments: string[];
};

export type ImportProblem = { row: number; reason: string };

/**
 * The most issues one import takes; a bigger source is split by the person
 * importing. An import holds the board's numbering for its length, so this
 * keeps that short.
 */
export const IMPORT_MAX_ISSUES = 1000;
/** Problems kept while reading a source; past this, more are not listed. */
export const PROBLEMS_KEPT = 50;
/** Longer source ids are kept as a hash, so any id fits the key. */
const KEY_MAX = 120;

/** An issue's key from its source and its id there, of a bounded length. */
export function sourceKey(source: string, id: string): string {
  const key = `${source}:${id}`;
  return key.length <= KEY_MAX
    ? key
    : `${source}:#${createHash('sha256').update(id).digest('base64url')}`;
}

const STATUS_WORDS: Record<string, IssueStatus> = {
  todo: 'TODO',
  'to do': 'TODO',
  open: 'TODO',
  backlog: 'TODO',
  new: 'TODO',
  'in progress': 'IN_PROGRESS',
  in_progress: 'IN_PROGRESS',
  doing: 'IN_PROGRESS',
  started: 'IN_PROGRESS',
  review: 'IN_REVIEW',
  'in review': 'IN_REVIEW',
  in_review: 'IN_REVIEW',
  done: 'DONE',
  closed: 'DONE',
  complete: 'DONE',
  completed: 'DONE',
  resolved: 'DONE',
  canceled: 'CANCELED',
  cancelled: 'CANCELED',
  "won't do": 'CANCELED',
  wontfix: 'CANCELED',
};

/** A status in a source's words, or to do when it says nothing this knows. */
export function statusFrom(value: string): IssueStatus {
  const word = value.trim().toLowerCase();
  const exact = ISSUE_STATUSES.find((status) => status.toLowerCase() === word);
  return exact ?? STATUS_WORDS[word] ?? 'TODO';
}

const PRIORITY_WORDS: Record<string, IssuePriority> = {
  critical: 'URGENT',
  highest: 'URGENT',
  p0: 'URGENT',
  p1: 'HIGH',
  p2: 'MEDIUM',
  normal: 'MEDIUM',
  p3: 'LOW',
  lowest: 'LOW',
};

/** A priority in a source's words, or none. */
export function priorityFrom(value: string): IssuePriority {
  const word = value.trim().toLowerCase();
  const exact = ISSUE_PRIORITIES.find((priority) => priority.toLowerCase() === word);
  return exact ?? PRIORITY_WORDS[word] ?? 'NONE';
}

/** A label colour this app has, from a source's own, or none to pick one. */
export function colourFrom(value: unknown): LabelColour | null {
  return typeof value === 'string' && (LABEL_COLOURS as readonly string[]).includes(value)
    ? (value as LabelColour)
    : null;
}
