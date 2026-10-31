import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Every package declares what it imports, and the root holds only tooling
 * (stage 2, item 18). A package that uses something it does not list works
 * only while a neighbour happens to install it, which is how an image or a
 * filtered install breaks later. This runs in CI with the suite.
 */

const ROOT = resolve(import.meta.dir, '..');
/** Build output and other things that are not this repository's source. */
const SKIP = /^(?:node_modules|\.next.*|\.git|\.trivy|robis-ml|public|imgs)$/;
/** What the repository root may install: the tools run across every package. */
const ROOT_TOOLING = ['@biomejs/biome', '@types/bun', 'knip', 'typescript'];
const BUILTIN = new Set([...builtinModules, 'bun', 'bun:test', 'bun:sqlite', 'bun:ffi', 'bun:jsc']);

// Static imports and re-exports start a line; anything mid-line is a string
// or a comment, except a dynamic `import('...')`.
const IMPORT =
  /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gm;

type Manifest = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function manifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest;
}

function walk(dir: string, packages: string[], files: string[]) {
  if (existsSync(join(dir, 'package.json'))) packages.push(dir);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, packages, files);
    else if (/\.(?:m?[jt]sx?)$/.test(entry.name)) files.push(path);
  }
}

/** The package a path belongs to: the deepest one containing it. */
function ownerOf(path: string, packages: readonly string[]): string {
  return packages
    .filter((dir) => path === dir || path.startsWith(`${dir}/`))
    .sort((a, b) => b.length - a.length)[0]!;
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * Imports in `source` that its package does not declare, and relative
 * imports that leave the package (a way round declaring it).
 */
function undeclared(
  file: string,
  source: string,
  packages: readonly string[],
  manifestOf: (dir: string) => Manifest = manifest,
): string[] {
  const home = ownerOf(file, packages);
  const own = manifestOf(home);
  const declared = new Set([
    own.name,
    ...Object.keys({ ...own.dependencies, ...own.devDependencies }),
  ]);
  const at = relative(ROOT, file);
  const found: string[] = [];
  for (const match of source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(IMPORT)) {
    const specifier = match[1] ?? match[2] ?? match[3]!;
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier);
      if (ownerOf(target, packages) !== home)
        found.push(`${at} reaches out of its package to ${specifier}`);
    } else if (!specifier.startsWith('node:') && !BUILTIN.has(specifier)) {
      const name = packageName(specifier);
      if (!declared.has(name))
        found.push(`${at} imports ${name}, which ${own.name} does not declare`);
    }
  }
  return found;
}

describe('declared imports', () => {
  const packages: string[] = [];
  const files: string[] = [];
  walk(ROOT, packages, files);

  test('every package declares what it imports', () => {
    const offenders = files.flatMap((file) =>
      undeclared(file, readFileSync(file, 'utf8'), packages),
    );
    expect(offenders).toEqual([]);
  });

  test('the root package holds only tooling', () => {
    const root = manifest(ROOT);
    const installed = Object.keys({ ...root.dependencies, ...root.devDependencies }).sort();
    expect(installed).toEqual([...ROOT_TOOLING].sort());
  });

  test('refuses an undeclared import, and a relative import out of the package', () => {
    const home = join(ROOT, 'backend/example');
    const fake = (dir: string): Manifest =>
      dir === home
        ? { name: '@robis/example', dependencies: { zod: '*' } }
        : { name: '@robis/other' };
    expect(
      undeclared(
        join(home, 'src/index.ts'),
        [
          "import { z } from 'zod';",
          "import type { FastifyInstance } from 'fastify';",
          "import { join } from 'node:path';",
          "import { test } from 'bun:test';",
          "import { own } from './own.ts';",
          "import { theirs } from '../../other/src/index.ts';",
          "const lazy = await import('sharp/lib/index');",
          '// import { ignored } from "in-a-comment";',
        ].join('\n'),
        [ROOT, home, join(ROOT, 'backend/other')],
        fake,
      ),
    ).toEqual([
      'backend/example/src/index.ts imports fastify, which @robis/example does not declare',
      'backend/example/src/index.ts reaches out of its package to ../../other/src/index.ts',
      'backend/example/src/index.ts imports sharp, which @robis/example does not declare',
    ]);
  });
});
