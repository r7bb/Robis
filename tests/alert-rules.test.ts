import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The alert rules hang together (A5). promtool, in CI, checks each rule
 * fires when it should; this checks the rest: every rule has a case that
 * fires it and one that must not, a runbook section its annotation links
 * to, and names only metrics a service really exports, so a renamed metric
 * cannot leave an alert silently watching nothing.
 */

const ROOT = join(import.meta.dir, '..');
const rules = readFileSync(join(ROOT, 'deploy/prometheus/alerts.yml'), 'utf8');
const ruleTests = readFileSync(join(ROOT, 'deploy/prometheus/alerts.test.yml'), 'utf8');
const runbook = readFileSync(join(ROOT, 'docs/RUNBOOK.md'), 'utf8');

/** Each rule's name and expression, read from the file as written. */
function alertRules(): { name: string; expr: string; runbook: string }[] {
  return rules
    .split(/\n\s*- alert: /)
    .slice(1)
    .map((block) => {
      const name = block.split('\n')[0]!.trim();
      const expr = /expr: ([\s\S]*?)\n\s+(?:for|labels):/.exec(block)?.[1] ?? '';
      const link = /runbook: (\S+)/.exec(block)?.[1] ?? '';
      return { name, expr, runbook: link };
    });
}

/** Every metric name a service registers, from the source. */
function exportedMetrics(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) {
        for (const [, name] of readFileSync(path, 'utf8').matchAll(/'(robis_[a-z_]+)'/g)) {
          names.add(name!);
        }
      }
    }
  };
  walk(join(ROOT, 'backend'));
  return names;
}

/** The test cases for one alert: whether each expects it to fire. */
function casesFor(name: string): boolean[] {
  const cases: boolean[] = [];
  const pattern = new RegExp(`alertname: ${name}\\n\\s+exp_alerts:( \\[\\])?`, 'g');
  for (const match of ruleTests.matchAll(pattern)) cases.push(match[1] === undefined);
  return cases;
}

describe('the alert rules', () => {
  const all = alertRules();

  test('there are rules, one per name', () => {
    expect(all.length).toBeGreaterThanOrEqual(9);
    expect(new Set(all.map((rule) => rule.name)).size).toBe(all.length);
  });

  test.each(alertRules().map((rule) => [rule.name, rule]))(
    '%s has a case that fires it and one that must not',
    (_name, rule) => {
      const cases = casesFor(rule.name);
      expect(cases).toContain(true);
      expect(cases).toContain(false);
    },
  );

  test.each(alertRules().map((rule) => [rule.name, rule]))(
    '%s has a runbook section, and its annotation links to it',
    (_name, rule) => {
      expect(runbook).toContain(`\n## ${rule.name}\n`);
      expect(rule.runbook).toBe(`docs/RUNBOOK.md#${rule.name.toLowerCase()}`);
    },
  );

  test('every metric a rule reads is one a service exports', () => {
    const exported = exportedMetrics();
    const read = new Set(
      all.flatMap((rule) =>
        [...rule.expr.matchAll(/\b(robis_[a-z_]+)/g)].map(([, name]) =>
          name!.replace(/_bucket$/, ''),
        ),
      ),
    );
    expect(read.size).toBeGreaterThan(0);
    expect([...read].filter((name) => !exported.has(name))).toEqual([]);
  });

  test('the runbook has no section for a rule that does not exist', () => {
    const names = new Set(all.map((rule) => rule.name));
    const sections = [...runbook.matchAll(/\n## (\S+)\n/g)].map(([, name]) => name!);
    expect(sections.filter((name) => !names.has(name))).toEqual([]);
  });
});
