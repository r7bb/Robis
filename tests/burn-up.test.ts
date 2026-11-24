import { describe, expect, test } from 'bun:test';
import { burnUp, evenPace } from '@robis/shared';

/**
 * A cycle's burn-up: how many of its issues were done by the end of each
 * of its days so far, on the asker's calendar; and where an even pace
 * would have it.
 */

describe('done by the end of each day', () => {
  test('counted up day by day, through today only', () => {
    const done = burnUp({
      startsOn: '2026-11-23',
      endsOn: '2026-12-06',
      today: '2026-11-26',
      finished: [
        { day: '2026-11-23', count: 1 },
        { day: '2026-11-25', count: 2 },
      ],
    });
    expect(done).toEqual([1, 1, 3, 3]);
  });

  test('done before the cycle began counts from its first day; after it ended, not at all', () => {
    const done = burnUp({
      startsOn: '2026-11-23',
      endsOn: '2026-11-25',
      today: '2026-11-30',
      finished: [
        { day: '2026-11-20', count: 2 },
        { day: '2026-11-24', count: 1 },
        { day: '2026-11-28', count: 4 },
      ],
    });
    expect(done).toEqual([2, 3, 3]);
  });

  test('a cycle not yet started has no days to show', () => {
    expect(
      burnUp({ startsOn: '2026-12-01', endsOn: '2026-12-14', today: '2026-11-24', finished: [] }),
    ).toEqual([]);
  });
});

describe('an even pace', () => {
  test('from none on the first morning to all of it by the last evening', () => {
    expect(evenPace(10, 5)).toEqual([2, 4, 6, 8, 10]);
    expect(evenPace(0, 3)).toEqual([0, 0, 0]);
  });
});
