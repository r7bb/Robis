import { afterEach, describe, expect, test } from 'bun:test';
import { setFormatLocale } from '@robis/web/lib/i18n/format.ts';
import { ago } from '@robis/web/lib/time.ts';

/**
 * How long ago, in words, for the Feed, Spaces and the security page: each
 * amount in its own unit, so five minutes reads as five minutes, never as
 * five seconds.
 */

const NOW = Date.parse('2026-11-25T08:00:00Z');
const before = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

afterEach(() => setFormatLocale('en', []));

describe('how long ago', () => {
  test('each amount in its own unit', () => {
    setFormatLocale('en', ['en-GB']);
    expect(ago(before(30), NOW)).toBe('30 seconds ago');
    expect(ago(before(5 * 60), NOW)).toBe('5 minutes ago');
    expect(ago(before(2 * 3600), NOW)).toBe('2 hours ago');
    expect(ago(before(31 * 3600), NOW)).toBe('yesterday');
    expect(ago(before(3 * 86_400), NOW)).toBe('3 days ago');
    expect(ago(before(10 * 86_400), NOW)).toBe('last week');
    expect(ago(before(400 * 86_400), NOW)).toBe('last year');
  });

  test('a moment slightly ahead, from a clock out of step, is now', () => {
    setFormatLocale('en', ['en-GB']);
    expect(ago(new Date(NOW + 5000).toISOString(), NOW)).toBe('now');
  });
});
