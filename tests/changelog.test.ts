import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expected, README_LATEST, withList } from '@robis/scripts/docs/whats-new.ts';
import { CHANGELOG, type Entry } from '@robis/web/features/landing/changelog.ts';

/*
 * The landing page, docs/WHATS_NEW.md and the README all list what has
 * shipped. They are kept in step by this test rather than by memory: an
 * entry added to the site's changelog fails here until What's new lists it,
 * and the README shows the newest few. Both lists are written from the
 * changelog by `bun run docs:whats-new` (stage 4, item 36).
 */

const ROOT = join(import.meta.dir, '..');
const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const WHATS_NEW = readFileSync(join(ROOT, 'docs', 'WHATS_NEW.md'), 'utf8');

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

  test("the README and What's new read exactly as the changelog writes them", () => {
    for (const { file, text } of expected()) {
      expect({ file, current: readFileSync(file, 'utf8') === text }).toEqual({
        file,
        current: true,
      });
    }
  });

  test('a new entry leaves both lists out of date until they are rewritten', () => {
    const added: Entry = { ...CHANGELOG[0]!, title: 'Something not yet listed' };
    for (const { file, text } of expected([added, ...CHANGELOG])) {
      expect({ file, current: readFileSync(file, 'utf8') === text }).toEqual({
        file,
        current: false,
      });
    }
  });

  test('refuses a document without the markers to write between', () => {
    expect(() => withList('# No markers here', 'latest', '- item')).toThrow(/markers/);
  });

  test('every entry has a brief for the lists', () => {
    for (const entry of CHANGELOG) expect(entry.brief.length).toBeGreaterThan(20);
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
