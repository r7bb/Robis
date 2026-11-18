import { describe, expect, test } from 'bun:test';
import { NOTIFICATION_KINDS } from '@robis/shared';
import { NOTIFICATION_KIND_NAMES } from '@robis/web/lib/notification-kinds.ts';

/** How kinds of notification are named on screen (C3). */
describe('kind names', () => {
  test('every kind has a name and a line saying when', () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(NOTIFICATION_KIND_NAMES[kind].name.length).toBeGreaterThan(0);
      expect(NOTIFICATION_KIND_NAMES[kind].when.endsWith('.')).toBe(true);
    }
  });
});
