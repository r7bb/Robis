import {
  type BoardFilter,
  boardFilterSchema,
  type IssuePriority,
  type IssueStatus,
} from '@robis/shared';

/**
 * The board's filter (C1) as it lives in the URL, so a filtered board can be
 * shared as a link, survives a reload and works offline: the board already
 * holds every issue on the device, so filtering is done here, not by asking
 * the server again.
 */

/** URL key for each filter field. Short, readable words, not field names. */
const URL_KEYS = {
  status: 'status',
  priority: 'priority',
  assigneeId: 'assignee',
  labelId: 'label',
  cycleId: 'cycle',
} as const satisfies Record<keyof BoardFilter, string>;

type Field = keyof typeof URL_KEYS;
const FIELDS = Object.keys(URL_KEYS) as Field[];

/**
 * Read a filter from the query string. A value that is not valid (a status
 * that does not exist, a mangled id) is dropped, not an error: an old link
 * should still open the board.
 */
export function filterFromParams(params: { get(key: string): string | null }): BoardFilter {
  const filter: Record<string, string> = {};
  for (const field of FIELDS) {
    const raw = params.get(URL_KEYS[field]);
    if (raw === null) continue;
    const parsed = boardFilterSchema.shape[field].safeParse(raw);
    if (parsed.success && parsed.data !== undefined) filter[field] = parsed.data;
  }
  return filter as BoardFilter;
}

/** The query string for a filter, in a fixed order; empty for no filter. */
export function filterToQuery(filter: BoardFilter): string {
  const params = new URLSearchParams();
  for (const field of FIELDS) {
    const value = filter[field];
    if (value) params.set(URL_KEYS[field], value);
  }
  return params.toString();
}

/** A copy of the filter with one field set, or cleared when `value` is empty. */
export function withField(filter: BoardFilter, field: Field, value: string): BoardFilter {
  const { [field]: _dropped, ...rest } = filter;
  return value ? ({ ...rest, [field]: value } as BoardFilter) : rest;
}

export function isFiltered(filter: BoardFilter): boolean {
  return FIELDS.some((field) => filter[field] !== undefined);
}

/** Two filters asking for the same issues. */
export function sameFilter(a: BoardFilter, b: BoardFilter): boolean {
  return filterToQuery(a) === filterToQuery(b);
}

type Card = {
  status: IssueStatus;
  priority: IssuePriority;
  assigneeId: string | null;
  labelIds?: readonly string[];
  cycleId?: string | null;
};

/** Whether a card passes the filter; every set field must match. */
export function matchesFilter(card: Card, filter: BoardFilter): boolean {
  if (filter.status && card.status !== filter.status) return false;
  if (filter.priority && card.priority !== filter.priority) return false;
  if (filter.assigneeId && card.assigneeId !== filter.assigneeId) return false;
  if (filter.labelId && !(card.labelIds ?? []).includes(filter.labelId)) return false;
  if (filter.cycleId && card.cycleId !== filter.cycleId) return false;
  return true;
}
