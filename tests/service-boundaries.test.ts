import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Services never import other services (stage 2, item 16). The API, the
 * gateway and the worker are deployed and scaled on their own; what they
 * share lives in a package of its own (`@robis/storage`, `@robis/database`,
 * `@robis/auth` and the rest), so no service image drags another's code and
 * dependencies along. This runs in CI with the rest of the suite.
 */

const ROOT = resolve(import.meta.dir, '..');
const SERVICES = { api: '@robis/api', realtime: '@robis/realtime', worker: '@robis/worker' };
type Service = keyof typeof SERVICES;

const SPECIFIER = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

/** The service a path inside `backend/` belongs to, if any. */
function serviceOf(path: string): Service | undefined {
  const top = relative(join(ROOT, 'backend'), path).split('/')[0] ?? '';
  return Object.hasOwn(SERVICES, top) ? (top as Service) : undefined;
}

/** Every import in `source` (a file of `from`) that reaches another service. */
function crossServiceImports(from: Service, file: string, source: string): string[] {
  const found: string[] = [];
  for (const [, specifier] of source.matchAll(SPECIFIER)) {
    if (!specifier) continue;
    const target = specifier.startsWith('.')
      ? serviceOf(resolve(dirname(file), specifier))
      : (Object.entries(SERVICES).find(
          ([, name]) => specifier === name || specifier.startsWith(`${name}/`),
        )?.[0] as Service | undefined);
    if (target && target !== from) found.push(`${relative(ROOT, file)} imports ${specifier}`);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('service boundaries', () => {
  test('no service imports another service', () => {
    const offenders = (Object.keys(SERVICES) as Service[]).flatMap((service) =>
      sourceFiles(join(ROOT, 'backend', service, 'src')).flatMap((file) =>
        crossServiceImports(service, file, readFileSync(file, 'utf8')),
      ),
    );
    expect(offenders).toEqual([]);
  });

  test('no service depends on another service in its package.json', () => {
    const offenders = (Object.keys(SERVICES) as Service[]).flatMap((service) => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, 'backend', service, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      return Object.entries(SERVICES)
        .filter(([other, name]) => other !== service && declared.includes(name))
        .map(([, name]) => `${service} depends on ${name}`);
    });
    expect(offenders).toEqual([]);
  });

  test('refuses a service reaching into another, by package or by path', () => {
    const file = join(ROOT, 'backend/worker/src/example.ts');
    expect(
      crossServiceImports(
        'worker',
        file,
        [
          "import { buildApp } from '@robis/api/app';",
          "import { gateway } from '../../realtime/src/gateway.ts';",
          "const lazy = await import('@robis/api/env');",
          "import { storageFromEnv } from '@robis/storage';",
          "import { runner } from './runner.ts';",
        ].join('\n'),
      ),
    ).toEqual([
      'backend/worker/src/example.ts imports @robis/api/app',
      'backend/worker/src/example.ts imports ../../realtime/src/gateway.ts',
      'backend/worker/src/example.ts imports @robis/api/env',
    ]);
  });
});
