import { describe, expect, test } from 'bun:test';
import {
  filterFromParams,
  filterToQuery,
  isFiltered,
  matchesFilter,
  sameFilter,
  withField,
} from '@robis/web/lib/board-filter.ts';

/** The board's filter in the URL (C1), and which cards it lets through. */

const LABEL = '0b6f7a52-3c1d-4a8e-9f00-2d5c1e7b9a41';
const PERSON = '6a1e2f3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b';

const card = {
  status: 'TODO' as const,
  priority: 'HIGH' as const,
  assigneeId: PERSON,
  labelIds: [LABEL],
};

describe('the board filter in the URL', () => {
  test('reads back what it wrote', () => {
    const filter = {
      status: 'TODO',
      priority: 'HIGH',
      assigneeId: PERSON,
      labelId: LABEL,
    } as const;
    const query = filterToQuery(filter);
    expect(query).toBe(`status=TODO&priority=HIGH&assignee=${PERSON}&label=${LABEL}`);
    expect(filterFromParams(new URLSearchParams(query))).toEqual(filter);
  });

  test('drops values that are not valid instead of failing', () => {
    const filter = filterFromParams(new URLSearchParams('status=SOMEDAY&label=nope&priority=LOW'));
    expect(filter).toEqual({ priority: 'LOW' });
  });

  test('no filter is an empty query', () => {
    expect(filterToQuery({})).toBe('');
    expect(isFiltered({})).toBe(false);
    expect(isFiltered({ priority: 'LOW' })).toBe(true);
  });

  test('setting a field returns a new filter, and an empty value clears it', () => {
    const before = { priority: 'LOW' } as const;
    const after = withField(before, 'status', 'DONE');
    expect(after).toEqual({ priority: 'LOW', status: 'DONE' });
    expect(before).toEqual({ priority: 'LOW' });
    expect(withField(after, 'priority', '')).toEqual({ status: 'DONE' });
  });

  test('two filters are the same whatever order their fields were set in', () => {
    expect(
      sameFilter({ status: 'TODO', priority: 'LOW' }, { priority: 'LOW', status: 'TODO' }),
    ).toBe(true);
    expect(sameFilter({ status: 'TODO' }, {})).toBe(false);
  });
});

describe('which cards a filter lets through', () => {
  test('every set field must match', () => {
    expect(matchesFilter(card, {})).toBe(true);
    expect(matchesFilter(card, { priority: 'HIGH', labelId: LABEL })).toBe(true);
    expect(matchesFilter(card, { priority: 'LOW' })).toBe(false);
    expect(matchesFilter(card, { assigneeId: LABEL })).toBe(false);
  });

  test('a card made offline has no labels yet, so a label filter hides it', () => {
    const { labelIds: _none, ...offline } = card;
    expect(matchesFilter(offline, { labelId: LABEL })).toBe(false);
  });
});
