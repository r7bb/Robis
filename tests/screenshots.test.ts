import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SHOT_WIDTH } from '@robis/scripts/capture/cdp.ts';
import sharp from 'sharp';

/**
 * Screenshots (stage 4, item 34): each is kept once, as WebP at the widest
 * any page shows it, and every one a document or page refers to exists.
 */

const ROOT = resolve(import.meta.dir, '..');
const tracked = Bun.spawnSync(['git', 'ls-files', 'imgs', 'frontend/public/shots'], { cwd: ROOT })
  .stdout.toString()
  .split('\n')
  .filter(Boolean);

const DOCUMENTS = ['README.md', 'docs/ARCHITECTURE.md', 'docs/HOW_IT_WORKS.md'];
const PAGES = ['frontend/features/landing/offline-story.tsx', 'frontend/app/how-it-works/page.tsx'];

/** Every image path a document or page refers to, from the repository root. */
function referenced(): string[] {
  const fromDocuments = DOCUMENTS.flatMap((document) =>
    [
      ...readFileSync(join(ROOT, document), 'utf8').matchAll(
        /(?:src="|\]\()((?:\.\.\/)?(?:imgs|frontend\/public\/shots)\/[^")]+)/g,
      ),
    ].map((m) => join(document, '..', m[1]!)),
  );
  const fromPages = PAGES.flatMap((page) =>
    [...readFileSync(join(ROOT, page), 'utf8').matchAll(/['"]\/(shots\/[^'"]+)['"]/g)].map(
      (m) => `frontend/public/${m[1]}`,
    ),
  );
  return [...new Set([...fromDocuments, ...fromPages])];
}

describe('screenshots', () => {
  test('every committed image is WebP', () => {
    expect(tracked.length).toBeGreaterThan(0);
    expect(tracked.filter((path) => !path.endsWith('.webp'))).toEqual([]);
  });

  test('no screenshot is kept twice', () => {
    const byHash = new Map<string, string[]>();
    for (const path of tracked) {
      const hash = createHash('sha256')
        .update(readFileSync(join(ROOT, path)))
        .digest('hex');
      byHash.set(hash, [...(byHash.get(hash) ?? []), path]);
    }
    expect([...byHash.values()].filter((paths) => paths.length > 1)).toEqual([]);
  });

  test('none is wider than the widest place it is shown', async () => {
    const wide: string[] = [];
    for (const path of tracked) {
      const { width = 0 } = await sharp(join(ROOT, path)).metadata();
      if (width > SHOT_WIDTH) wide.push(`${path}: ${width}`);
    }
    expect(wide).toEqual([]);
  });

  test('every image a document or page refers to is committed', () => {
    const missing = referenced().filter((path) => !tracked.includes(path));
    expect(referenced().length).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });
});
