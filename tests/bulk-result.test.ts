import { describe, expect, test } from 'bun:test';
import { describeResult } from '@robis/web/lib/bulk-result.ts';

/** What the board says after a bulk change (C1): nothing skipped silently. */

describe('the bulk change summary', () => {
  test('says how many changed', () => {
    expect(describeResult({ changed: ['a'], skipped: [] })).toBe('Changed 1 issue.');
    expect(describeResult({ changed: ['a', 'b'], skipped: [] })).toBe('Changed 2 issues.');
  });

  test('counts what was left alone, by reason', () => {
    const said = describeResult({
      changed: ['a'],
      skipped: [
        { id: 'b', reason: 'forbidden' },
        { id: 'c', reason: 'unchanged' },
        { id: 'd', reason: 'forbidden' },
      ],
    });
    expect(said).toBe('Changed 1 issue. Left 3: 2 not yours to change, 1 already that way.');
  });
});
