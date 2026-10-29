import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  brokenLinks,
  INVENTORIES,
  missingQuotedPaths,
  trackedMarkdown,
} from '@robis/scripts/docs/links.ts';

const ROOT = join(import.meta.dir, '..');
const FIXTURE = join(import.meta.dir, 'fixtures', 'doc-links');

describe('the documentation link check', () => {
  test('finds the one broken link in the fixture, and nothing it should skip', () => {
    const broken = brokenLinks(FIXTURE, ['index.md', 'sub/page.md']);

    expect(broken).toEqual([{ file: 'index.md', line: 17, target: 'sub/missing.md' }]);
  });

  test('a quoted path in an inventory must exist', () => {
    const missing = missingQuotedPaths(FIXTURE, ['inventory.md']);

    expect(missing).toEqual([{ file: 'inventory.md', line: 4, target: 'backend/nowhere.ts' }]);
  });

  test('every path the app inventory names exists', () => {
    expect(missingQuotedPaths(ROOT, INVENTORIES)).toEqual([]);
  });

  test('every relative link in the repository resolves', () => {
    const files = trackedMarkdown(ROOT);

    expect(files.length).toBeGreaterThan(3);
    expect(brokenLinks(ROOT, files)).toEqual([]);
  });
});

/**
 * Test counts live in one place, the roadmap's status line. They used to be
 * quoted in four documents, and four documents disagreed (367, 400, "over
 * 460", "over 500"). Anywhere else, a number of tests is drift waiting to
 * happen, so it is refused here.
 */
describe('test counts', () => {
  const COUNT = /\b\d{2,}\s+(?:TypeScript\s+|Python\s+)?tests?\b|\bover\s+\d+\s+tests\b/i;

  test('appear only in the roadmap', () => {
    for (const file of trackedMarkdown(ROOT)) {
      if (file === 'docs/ROADMAP.md') continue;
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect({ file, count: text.match(COUNT)?.[0] ?? null }).toEqual({ file, count: null });
    }
  });

  test('the roadmap states them', () => {
    const roadmap = readFileSync(join(ROOT, 'docs', 'ROADMAP.md'), 'utf8');
    expect(roadmap).toMatch(/\d+ TypeScript tests, \d+ Python tests/);
  });
});
