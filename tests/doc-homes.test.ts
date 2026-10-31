import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * One home per topic (stage 4, item 37): status, the known gaps, what waits
 * on legal review and what is deliberately not being built are written in
 * docs/ROADMAP.md alone. Two copies of a status drift: one is corrected when
 * a feature lands and the other goes on calling it missing.
 */

const ROOT = resolve(import.meta.dir, '..');
const HOME = 'docs/ROADMAP.md';
/** A section heading that belongs in the home and nowhere else. */
const STATUS_HEADING =
  /^#{1,6} .*(status|known gaps|limitations|deliberately|not doing|legal review|what.s left)/gim;

const documents = Bun.spawnSync(['git', 'ls-files', '*.md'], { cwd: ROOT })
  .stdout.toString()
  .split('\n')
  .filter((path) => path && !path.startsWith('tests/fixtures/'));

/** The status-like headings in `markdown`. */
function statusHeadings(markdown: string): string[] {
  return [...markdown.matchAll(STATUS_HEADING)].map((m) => m[0]);
}

describe('one home per topic', () => {
  test('status, gaps and what is not being built have headings only in the roadmap', () => {
    const elsewhere = documents
      .filter((path) => path !== HOME)
      .flatMap((path) =>
        statusHeadings(readFileSync(join(ROOT, path), 'utf8')).map((h) => `${path}: ${h}`),
      );
    expect(elsewhere).toEqual([]);
  });

  test('the roadmap holds each of them', () => {
    const headings = statusHeadings(readFileSync(join(ROOT, HOME), 'utf8')).join('\n');
    for (const topic of [/known gaps/i, /legal review/i, /deliberately not doing/i]) {
      expect(headings).toMatch(topic);
    }
  });

  test('would refuse a second copy', () => {
    expect(statusHeadings('# Guide\n\n## Known gaps\n\n| Gap |')).toEqual(['## Known gaps']);
    expect(statusHeadings('# Guide\n\n## Status\n\nDone.')).toEqual(['## Status']);
  });

  test('the inventory and the reasoning point to the roadmap for the rest', () => {
    for (const path of [
      'COMPLETE_APP_SUMMARY.md',
      'docs/ARCHITECTURE.md',
      'docs/HOW_IT_WORKS.md',
    ]) {
      expect({
        path,
        links: readFileSync(join(ROOT, path), 'utf8').includes('ROADMAP.md'),
      }).toEqual({ path, links: true });
    }
  });
});
