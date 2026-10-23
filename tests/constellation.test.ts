import { describe, expect, test } from 'bun:test';
import {
  layoutNodes,
  MAX_NODE_RADIUS,
  MIN_NODE_RADIUS,
  nodeRadius,
  paletteFor,
  sparkPoint,
} from '../frontend/features/home/constellation-scene.ts';

/**
 * The home's constellation: where each workspace sits, how big it is, the
 * colours of the hour, and the path a live event's spark travels. The
 * drawing itself is checked in Chrome.
 */

describe('laying out the workspaces', () => {
  test('keeps every node inside the scene, and apart from the others', () => {
    for (const narrow of [false, true]) {
      for (let count = 1; count <= 6; count++) {
        const nodes = layoutNodes(count, narrow);
        expect(nodes).toHaveLength(count);
        for (const node of nodes) {
          expect(node.x).toBeGreaterThan(0.05);
          expect(node.x).toBeLessThan(0.95);
          expect(node.y).toBeGreaterThan(0.1);
          expect(node.y).toBeLessThan(0.9);
        }
        for (let a = 0; a < nodes.length; a++) {
          for (let b = a + 1; b < nodes.length; b++) {
            const gap = Math.hypot(nodes[a]!.x - nodes[b]!.x, nodes[a]!.y - nodes[b]!.y);
            expect(gap).toBeGreaterThan(0.08);
          }
        }
      }
    }
  });

  test('on a wide screen, stays clear of the greeting on the left; narrow, sits below it', () => {
    for (const node of layoutNodes(6, true)) expect(node.y).toBeGreaterThan(0.75);
    // The greeting keeps to the left half on a wide screen.
    for (const node of layoutNodes(6, false)) expect(node.x).toBeGreaterThan(0.52);
  });

  test('is the same every time, so a refetch does not rearrange the sky', () => {
    expect(layoutNodes(4, false)).toEqual(layoutNodes(4, false));
  });
});

test('a workspace with more open issues is bigger, within bounds', () => {
  expect(nodeRadius(0)).toBe(MIN_NODE_RADIUS);
  expect(nodeRadius(9)).toBeGreaterThan(nodeRadius(1));
  expect(nodeRadius(10_000)).toBe(MAX_NODE_RADIUS);
});

test('the colours follow the time of day', () => {
  expect(paletteFor(8).name).toBe('morning');
  expect(paletteFor(14).name).toBe('afternoon');
  expect(paletteFor(21).name).toBe('evening');
  expect(paletteFor(3).name).toBe('evening');
  for (const hour of [8, 14, 21]) {
    const palette = paletteFor(hour);
    expect(palette.a).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
    expect(palette.b).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  }
});

test('a spark starts where it was sent from and lands on its workspace', () => {
  const from = { x: 10, y: 200 };
  const to = { x: 300, y: 80 };
  expect(sparkPoint(from, to, 0)).toEqual(from);
  expect(sparkPoint(from, to, 1)).toEqual(to);
  // Curved, not straight: the midpoint lifts off the straight line.
  const mid = sparkPoint(from, to, 0.5);
  expect(mid.y).toBeLessThan((from.y + to.y) / 2);
});
