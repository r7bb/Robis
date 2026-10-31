import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import config from '@robis/web/next.config.ts';

/**
 * One sharp (stage 2, item 19). The API resizes uploads with it and the
 * screenshot script encodes WebP with it; the web app has none. Next would bring
 * its own copy for image optimisation, which the app no longer uses. Two
 * versions of a native library is two sets of binaries to patch.
 */

const ROOT = resolve(import.meta.dir, '..');
const lock = readFileSync(join(ROOT, 'bun.lock'), 'utf8');

/** Every version the lockfile resolves a package to, however it got there. */
function resolvedVersions(name: string): string[] {
  const escaped = name.replace(/[/@.-]/g, (c) => `\\${c}`);
  const found = [...lock.matchAll(new RegExp(`\\["${escaped}@([^"]+)"`, 'g'))].map((m) => m[1]!);
  return [...new Set(found)].sort();
}

describe('one sharp', () => {
  test('the lockfile holds one version of sharp, and its binaries match it', () => {
    const versions = resolvedVersions('sharp');
    expect(versions).toHaveLength(1);
    const [sharp] = versions;
    for (const binary of new Set(
      [...lock.matchAll(/"(@img\/sharp-(?!libvips)[a-z0-9-]+)@/g)].map((m) => m[1]!),
    )) {
      expect({ binary, versions: resolvedVersions(binary) }).toEqual({
        binary,
        versions: [sharp!],
      });
    }
  });

  test('Next serves images as they are, so it never loads its own sharp', () => {
    expect(config.images?.unoptimized).toBe(true);
  });

  test('the web app does not depend on sharp', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'frontend/package.json'), 'utf8'));
    expect({ ...manifest.dependencies, ...manifest.devDependencies }).not.toHaveProperty('sharp');
  });

  test('the landing asks only for committed WebP, which needs no image library', () => {
    const pages = [
      'frontend/features/landing/offline-story.tsx',
      'frontend/app/how-it-works/page.tsx',
    ].map((file) => readFileSync(join(ROOT, file), 'utf8'));
    const shots = pages.flatMap((source) =>
      [...source.matchAll(/['"]\/shots\/([^'"]+)['"]/g)].map((m) => m[1]!),
    );
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      expect(shot).toMatch(/\.webp$/);
      const file = join(ROOT, 'frontend/public/shots', shot);
      expect({ shot, committed: existsSync(file) }).toEqual({ shot, committed: true });
    }
  });
});
