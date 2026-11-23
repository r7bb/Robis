import { describe, expect, test } from 'bun:test';
import { importSummary } from '@robis/web/features/meetings/import-summary.ts';

/** What the import says it did (B8): counts first, then what was left out and why. */

const made = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    title: `M${i}`,
    invited: 0,
  }));

describe('the import summary', () => {
  test('counts, with the right word', () => {
    expect(
      importSummary({ found: 1, created: made(1), skipped: [], attendeesLeftOff: false }),
    ).toBe('Imported 1 meeting.');
    expect(
      importSummary({ found: 3, created: made(3), skipped: [], attendeesLeftOff: false }),
    ).toBe('Imported 3 meetings.');
  });

  test('what was left out, at most three, then how many more', () => {
    const skipped = [
      { title: 'All day', reason: 'an all-day event' },
      { title: 'Daily', reason: 'repeats other than once a week' },
      { title: null, reason: 'more than 50 events in one file' },
      { title: 'Off', reason: 'it was cancelled' },
      { title: 'Mars', reason: 'a time zone this server does not know' },
    ];
    expect(importSummary({ found: 6, created: made(1), skipped, attendeesLeftOff: false })).toBe(
      'Imported 1 meeting. Left out: All day (an all-day event); Daily (repeats other than once a week); more than 50 events in one file, and 2 more.',
    );
    expect(
      importSummary({
        found: 1,
        created: [],
        skipped: skipped.slice(0, 1),
        attendeesLeftOff: false,
      }),
    ).toBe('Nothing was imported. Left out: All day (an all-day event).');
  });
});

test('says when the people named were left off, and why', () => {
  expect(importSummary({ found: 1, created: made(1), skipped: [], attendeesLeftOff: true })).toBe(
    'Imported 1 meeting. The people named in the file were not added: only admins can match addresses to people.',
  );
});
