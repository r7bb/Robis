import { describe, expect, test } from 'bun:test';
import { weekStart } from '@robis/api/feed-week';

describe('the check-in week', () => {
  test('starts on Monday at midnight UTC, whatever day it is', () => {
    const monday = '2026-11-16T00:00:00.000Z';
    expect(weekStart(new Date('2026-11-16T00:00:00Z')).toISOString()).toBe(monday);
    expect(weekStart(new Date('2026-11-20T12:34:00Z')).toISOString()).toBe(monday);
    expect(weekStart(new Date('2026-11-22T23:59:59Z')).toISOString()).toBe(monday);
    expect(weekStart(new Date('2026-11-23T00:00:01Z')).toISOString()).toBe(
      '2026-11-23T00:00:00.000Z',
    );
  });
});
