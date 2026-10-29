import { describe, expect, test } from 'bun:test';
import { areaPath, paletteFor, stackSeries } from '@robis/web/features/home/hero-scene.ts';

/**
 * The signed-in home's hero: the activity river's stacking and shapes, and
 * the aurora's colours of the hour. The drawing is checked in Chrome.
 */

describe('stacking the river', () => {
  test('lays each workspace on top of the ones before it', () => {
    const [a, b] = stackSeries([
      { id: 'a', values: [1, 2, 0] },
      { id: 'b', values: [3, 0, 4] },
    ]);
    expect(a).toEqual({ id: 'a', lower: [0, 0, 0], upper: [1, 2, 0] });
    expect(b).toEqual({ id: 'b', lower: [1, 2, 0], upper: [4, 2, 4] });
  });

  test('is empty for no workspaces', () => {
    expect(stackSeries([])).toEqual([]);
  });
});

describe('the shape of a band', () => {
  test('runs along its top, then back along its bottom, and closes', () => {
    const d = areaPath([0, 50, 100], [10, 20, 10], [0, 0, 0], 100);
    expect(d.startsWith('M0,90')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    // Back along the baseline at the bottom of the box.
    expect(d).toContain('L100,100');
  });

  test('stays inside its box: a curve never dips below zero or above the peak', () => {
    const d = areaPath([0, 25, 50, 75, 100], [0, 40, 0, 40, 0], [0, 0, 0, 0, 0], 100);
    const ys = [...d.matchAll(/,(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});

test('the colours follow the time of day', () => {
  expect(paletteFor(8).name).toBe('morning');
  expect(paletteFor(14).name).toBe('afternoon');
  expect(paletteFor(21).name).toBe('evening');
  expect(paletteFor(3).name).toBe('evening');
});
