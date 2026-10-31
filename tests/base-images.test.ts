import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Base images are re-pinned on a schedule (stage 4, item 38): each one is a
 * literal FROM line pinned by digest, which is the only form Dependabot
 * reads (it skips a FROM built from an ARG), Dependabot proposes new
 * digests weekly, and CI rebuilds and scans every week without a push.
 */

const ROOT = resolve(import.meta.dir, '..');
const DOCKER = join(ROOT, 'deploy/docker');
const dockerfiles = readdirSync(DOCKER).filter((name) => name.endsWith('.Dockerfile'));

/** The FROM lines that start from an image rather than an earlier stage. */
function externalBases(dockerfile: string): string[] {
  const stages = new Set<string>();
  const bases: string[] = [];
  for (const [, image, stage] of dockerfile.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gim)) {
    if (!stages.has(image!)) bases.push(image!);
    if (stage) stages.add(stage);
  }
  return bases;
}

/** A base Dependabot can update: a literal name and tag, pinned by digest. */
const PINNED = /^[a-z0-9./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/;

describe('base images', () => {
  test('every base is a literal image pinned by version and digest', () => {
    const bases = dockerfiles.flatMap((name) =>
      externalBases(readFileSync(join(DOCKER, name), 'utf8')).map((image) => ({ name, image })),
    );
    expect(bases.length).toBeGreaterThan(0);
    expect(bases.filter(({ image }) => !PINNED.test(image))).toEqual([]);
  });

  test('would refuse a base taken from a build argument, or one without a digest', () => {
    expect(externalBases('ARG BASE=x\nFROM $BASE AS build').every((i) => PINNED.test(i))).toBe(
      false,
    );
    expect(PINNED.test('oven/bun:1.4.2-slim')).toBe(false);
    expect(externalBases('FROM a:1@sha256:x AS one\nFROM one AS two')).toEqual(['a:1@sha256:x']);
  });

  test('Dependabot proposes new digests for them every week', () => {
    const config = readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8');
    expect(config).toMatch(/package-ecosystem: docker\s+directory: \/deploy\/docker/);
    expect(config).toMatch(/interval: weekly/);
  });

  test('Dependabot proposes digests only, never a new Bun or Python version', () => {
    const config = Bun.YAML.parse(readFileSync(join(ROOT, '.github/dependabot.yml'), 'utf8')) as {
      updates: { ignore?: { 'dependency-name': string; 'update-types': string[] }[] }[];
    };
    const ignored = config.updates[0]?.ignore?.find((rule) => rule['dependency-name'] === '*');
    expect(ignored?.['update-types'].sort()).toEqual([
      'version-update:semver-major',
      'version-update:semver-minor',
      'version-update:semver-patch',
    ]);
  });

  test('CI rebuilds and scans them on a schedule, not only on a push', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toMatch(/^ {2}schedule:\n {4}- cron: '[^']+'/m);
  });

  test('a push cannot cancel the weekly run, and the weekly run restores no cached layers', () => {
    const workflow = Bun.YAML.parse(
      readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8'),
    ) as {
      concurrency: { group: string };
      jobs: { containers: { steps: { name?: string; run?: string }[] } };
    };
    expect(workflow.concurrency.group).toContain('github.event_name');
    const build = workflow.jobs.containers.steps.find((step) => step.name === 'Build every image');
    expect(build?.run).toMatch(
      /if \[ "\$EVENT" != schedule \]; then\n\s+args="\$args --set \$image\.cache-from/,
    );
  });
});
