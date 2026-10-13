import { describe, expect, test } from 'bun:test';
import { safeNext } from '../frontend/lib/safe-next.ts';

describe('where the welcome step sends you next', () => {
  test('a path on this site is kept', () => {
    expect(safeNext('/workspaces/abc')).toBe('/workspaces/abc');
    // Already decoded by the time it arrives, an encoded tab is just a
    // character in a local path, and stays on this site.
    expect(safeNext('/%09/x')).toBe('/%09/x');
    expect(safeNext('/account?tab=profile')).toBe('/account?tab=profile');
  });

  test('anything that could leave the site goes to the workspaces list instead', () => {
    for (const hostile of [
      'https://evil.example',
      '//evil.example/path',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\t\\evil.example',
      'javascript:alert(1)',
      'workspaces',
      '',
      null,
    ]) {
      expect(safeNext(hostile)).toBe('/workspaces');
    }
  });
});
