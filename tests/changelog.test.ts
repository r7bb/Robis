import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGELOG } from '../frontend/features/landing/changelog.ts';

/*
 * The landing page, docs/WHATS_NEW.md and the README all list what has
 * shipped. They are kept in step by this test rather than by memory: an
 * entry added to the site's changelog fails here until What's new lists it,
 * and the README shows the newest few.
 */

const ROOT = join(import.meta.dir, '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const WHATS_NEW = readFileSync(join(ROOT, 'docs', 'WHATS_NEW.md'), 'utf8');
/** How many of the newest entries the README itself shows. */
const README_LATEST = 3;

describe('the changelog', () => {
  test.each(CHANGELOG.map((entry) => [entry.title]))('What\'s new lists "%s"', (title) => {
    expect(WHATS_NEW).toContain(title);
  });

  test.each(CHANGELOG.slice(0, README_LATEST).map((entry) => [entry.title]))(
    'the README shows the latest, "%s"',
    (title) => {
      expect(README).toContain(title);
    },
  );

  test('is newest first', () => {
    const dates = CHANGELOG.map((entry) => entry.date);

    expect([...dates].sort().reverse()).toEqual(dates);
  });

  test('says how every entry was checked', () => {
    for (const entry of CHANGELOG) expect(entry.checked.length).toBeGreaterThan(20);
  });

  test('every feature says where to find it and what each layer does', () => {
    const features = CHANGELOG.flatMap((entry) => (entry.feature ? [entry.feature] : []));
    expect(features.length).toBeGreaterThan(0);

    for (const feature of features) {
      expect(feature.where.length).toBeGreaterThan(10);
      expect(feature.layers.length).toBeGreaterThanOrEqual(2);
      // The What's new page splits each layer on its first ": " into label and text.
      for (const layer of feature.layers) expect(layer).toMatch(/^[A-Z][\w ]+: \S/);
    }
  });
});
