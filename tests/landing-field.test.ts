import { describe, expect, test } from 'bun:test';
import {
  approach,
  FIELD_MODES,
  type FieldMode,
  modeForLetter,
  RING_REPEAT_SECONDS,
  ringAge,
  stepSurface,
} from '../frontend/features/landing/field-modes.ts';

/*
 * Each letter of the name stands for something the product does, and the
 * field behind it acts that out. These tests hold the table to its meaning,
 * so a tweak to one formation cannot quietly bleed into another: only
 * "offline" may grey the surface, only "board" may split it into columns.
 */

const MODES = Object.keys(FIELD_MODES) as FieldMode[];

describe('FIELD_MODES', () => {
  test('only offline greys the surface out', () => {
    for (const mode of MODES) {
      expect(FIELD_MODES[mode].offline).toBe(mode === 'offline' ? 1 : 0);
    }
  });

  test('only the board splits the surface into columns', () => {
    for (const mode of MODES) {
      expect(FIELD_MODES[mode].columns).toBe(mode === 'board' ? 1 : 0);
    }
  });

  test('only sync sends waves in from both sides', () => {
    for (const mode of MODES) {
      expect(FIELD_MODES[mode].merge).toBe(mode === 'merge' ? 1 : 0);
    }
  });

  test('only the idempotent step repeats its ring', () => {
    for (const mode of MODES) {
      expect(FIELD_MODES[mode].repeatRing).toBe(mode === 'once');
    }
  });

  test('realtime moves fastest and offline slowest', () => {
    const speeds = MODES.map((mode) => FIELD_MODES[mode].speed);

    expect(FIELD_MODES.realtime.speed).toBe(Math.max(...speeds));
    expect(FIELD_MODES.offline.speed).toBe(Math.min(...speeds));
  });
});

describe('modeForLetter', () => {
  test('maps each letter of the name to its formation', () => {
    expect(['R', 'O', 'B', 'I', 'S'].map(modeForLetter)).toEqual([
      'realtime',
      'offline',
      'board',
      'once',
      'merge',
    ]);
  });

  test('no letter means the resting surface', () => {
    expect(modeForLetter(null)).toBe('idle');
  });
});

describe('approach', () => {
  test('moves part of the way towards the target', () => {
    expect(approach(0, 1, 0.25)).toBeCloseTo(0.25);
  });

  test('a rate of one lands at once, which is how reduced motion behaves', () => {
    expect(approach(0.3, 1, 1)).toBe(1);
  });

  test('repeated steps converge without overshooting', () => {
    let value = 0;
    for (let i = 0; i < 200; i++) value = approach(value, 1, 0.06);

    expect(value).toBeLessThanOrEqual(1);
    expect(value).toBeCloseTo(1, 4);
  });
});

describe('stepSurface', () => {
  const resting = { phase: 0, speed: 1, offline: 0, columns: 0, merge: 0 };

  test('advances the phase by speed times elapsed time', () => {
    const next = stepSurface(resting, FIELD_MODES.idle, 1, 0.5);

    expect(next.phase).toBeCloseTo(0.5);
  });

  test('eases every value towards the new mode without touching the old state', () => {
    const next = stepSurface(resting, FIELD_MODES.offline, 0.5, 0);

    expect(next.offline).toBeCloseTo(0.5);
    expect(next.speed).toBeCloseTo(0.575);
    expect(resting.offline).toBe(0);
  });
});

describe('ringAge', () => {
  test('a single merge ring ages from the moment it was sent', () => {
    expect(ringAge(3000, 1000, false, 1)).toBeCloseTo(2);
  });

  test('the repeating ring restarts on its own cycle', () => {
    expect(
      ringAge(RING_REPEAT_SECONDS * 1000 + 500, Number.NEGATIVE_INFINITY, true, 1),
    ).toBeCloseTo(0.5);
  });

  test('under reduced motion the repeating ring is not sent at all', () => {
    expect(ringAge(500, Number.NEGATIVE_INFINITY, true, 0)).toBeGreaterThan(5);
  });
});
