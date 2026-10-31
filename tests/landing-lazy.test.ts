import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The landing's heavy pieces load after the page is usable (stage 3, item
 * 33): the WebGL field and the live sync demo are fetched as chunks of their
 * own, when their spot comes into view. A plain import anywhere on the
 * landing would put them back in the first bundle, so only `lazy.tsx` may
 * name them, and only through `next/dynamic`.
 */

const ROOT = resolve(import.meta.dir, '..');
const LANDING = [
  ...readdirSync(join(ROOT, 'frontend/features/landing'))
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => `frontend/features/landing/${name}`),
  'frontend/app/page.tsx',
];
const HEAVY = ['field.tsx', 'sync-demo.tsx'];

describe('the landing loads its heavy pieces lazily', () => {
  test('nothing on the landing imports them directly', () => {
    const direct = LANDING.flatMap((file) => {
      if (file.endsWith('/lazy.tsx') || HEAVY.some((heavy) => file.endsWith(`/${heavy}`)))
        return [];
      const source = readFileSync(join(ROOT, file), 'utf8');
      return HEAVY.filter((heavy) =>
        new RegExp(`from ['"](?:\\./|.*/landing/)${heavy.replace('.', '\\.')}['"]`).test(source),
      ).map((heavy) => `${file} imports ${heavy}`);
    });
    expect(direct).toEqual([]);
  });

  test('lazy.tsx loads each through next/dynamic, never on the server', () => {
    const source = readFileSync(join(ROOT, 'frontend/features/landing/lazy.tsx'), 'utf8');
    for (const heavy of HEAVY) {
      expect(source).toMatch(
        new RegExp(`dynamic\\(\\s*\\(\\) => import\\('\\./${heavy.replace('.', '\\.')}'\\)`),
      );
    }
    expect(source.match(/ssr: false/g)).toHaveLength(HEAVY.length);
  });
});
