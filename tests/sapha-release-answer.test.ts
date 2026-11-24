import { describe, expect, test } from 'bun:test';
import { releaseAsked } from '@robis/web/features/sapha/release-answer-model.ts';

/** Which release Sapha answers about: the one named, else the next to ship. */

const release = (name: string, shippedAt: string | null = null) => ({ name, shippedAt });
// As the API lists them: still to ship by the day aimed at, then shipped.
const LIST = [
  release('Relaunch 1.0'),
  release('Version 2.0'),
  release('Beta', '2026-11-01T10:00:00Z'),
];

describe('the release asked about', () => {
  test('the next to ship when none is named', () => {
    expect(releaseAsked(LIST, null)?.name).toBe('Relaunch 1.0');
    expect(releaseAsked([release('Beta', '2026-11-01T10:00:00Z')], null)).toBeNull();
  });

  test('by its name exactly, else a name holding the words, shipped ones too', () => {
    expect(releaseAsked(LIST, 'version 2.0')?.name).toBe('Version 2.0');
    expect(releaseAsked(LIST, 'relaunch')?.name).toBe('Relaunch 1.0');
    expect(releaseAsked(LIST, 'beta')?.name).toBe('Beta');
    expect(releaseAsked(LIST, 'Gamma')).toBeNull();
  });
});
