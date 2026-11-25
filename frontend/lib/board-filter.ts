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
  releaseId: 'release',
  carried: 'carried',
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
  releaseId?: string | null;
  carriedOver?: number;
};

/** Each field's test of a card, for a filter that sets it. */
const TESTS: { [F in Field]: (card: Card, value: NonNullable<BoardFilter[F]>) => boolean } = {
  status: (card, value) => card.status === value,
  priority: (card, value) => card.priority === value,
  assigneeId: (card, value) => card.assigneeId === value,
  labelId: (card, value) => (card.labelIds ?? []).includes(value),
  cycleId: (card, value) => card.cycleId === value,
  releaseId: (card, value) => card.releaseId === value,
  carried: (card) => (card.carriedOver ?? 0) > 0,
};

/** Whether a card passes the filter; every set field must match. */
export function matchesFilter(card: Card, filter: BoardFilter): boolean {
  return FIELDS.every((field) => {
    const value = filter[field];
    return value === undefined || (TESTS[field] as (c: Card, v: string) => boolean)(card, value);
  });
}
