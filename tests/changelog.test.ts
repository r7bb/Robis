import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGELOG } from '../frontend/features/landing/changelog.ts';

/*
 * The landing page and the README both list what has shipped. They are kept
 * in step by this test rather than by memory: an entry added to the site's
 * changelog fails here until the README says the same.
 */

const README = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8');

describe('the changelog', () => {
  test.each(CHANGELOG.map((entry) => [entry.title]))('the README lists "%s"', (title) => {
    expect(README).toContain(title);
  });

  test('is newest first', () => {
    const dates = CHANGELOG.map((entry) => entry.date);

    expect([...dates].sort().reverse()).toEqual(dates);
  });

  test('says how every entry was checked', () => {
    for (const entry of CHANGELOG) expect(entry.checked.length).toBeGreaterThan(20);
  });
});
