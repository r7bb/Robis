/**
 * The plain parts of the home's constellation (`constellation.tsx`), kept
 * apart from the canvas so they can be tested: where each workspace sits,
 * how big it is, the colours of the hour, and a spark's path.
 */

export type Point = { x: number; y: number };

export const MIN_NODE_RADIUS = 9;
export const MAX_NODE_RADIUS = 30;

/**
 * Where each workspace sits, as fractions of the scene. On a wide screen
 * they arc across the right half, beside the greeting; on a narrow one they
 * spread along a band at the bottom, under it. The same count always gives the same
 * places, so a refetch never rearranges the sky.
 */
export function layoutNodes(count: number, narrow: boolean): Point[] {
  if (count <= 0) return [];
  // Wide: the right half, beside the greeting. Narrow: a band of its own
  // below the text (the hero leaves room for it).
  const left = narrow ? 0.1 : 0.56;
  const right = narrow ? 0.9 : 0.93;
  const middle = narrow ? 0.84 : 0.6;
  const lift = narrow ? 0.04 : 0.16;

  // A lone workspace sits mid-height, in the open, not up under the header.
  if (count === 1) return [{ x: narrow ? 0.5 : 0.74, y: middle }];

  return Array.from({ length: count }, (_, i) => {
    // One workspace sits on the arc's crest; more spread along it.
    const t = count === 1 ? 0.5 : i / (count - 1);
    const x = left + (right - left) * t;
    // An arc, with alternate nodes nudged up and down so they read as a
    // constellation rather than a row of beads.
    const arc = -Math.sin(Math.PI * t) * lift;
    const nudge = count > 2 ? (i % 2 === 0 ? -1 : 1) * (narrow ? 0.03 : 0.08) : 0;
    return { x, y: middle + arc + nudge };
  });
}

/** Grows with the square root of open issues, so a busy workspace is bigger without swallowing the rest. */
export function nodeRadius(openIssues: number): number {
  const r = MIN_NODE_RADIUS + Math.sqrt(Math.max(0, openIssues)) * 3;
  return Math.min(MAX_NODE_RADIUS, r);
}

export type Palette = {
  name: 'morning' | 'afternoon' | 'evening';
  /** Two aurora colours, as `r g b` channels for `rgb(var(--x) / a)`. */
  a: string;
  b: string;
};

/** Warm in the morning, clear in the afternoon, deep in the evening. */
export function paletteFor(hour: number): Palette {
  if (hour >= 5 && hour < 12) return { name: 'morning', a: '251 146 60', b: '244 114 182' };
  if (hour >= 12 && hour < 18) return { name: 'afternoon', a: '45 212 191', b: '56 189 248' };
  return { name: 'evening', a: '129 140 248', b: '192 132 252' };
}

/**
 * Where a spark is at `t` (0 to 1) on its way to a workspace: a curve that
 * bows upward, the way a thrown thing travels, rather than a straight line.
 */
export function sparkPoint(from: Point, to: Point, t: number): Point {
  const control = {
    x: (from.x + to.x) / 2,
    y: Math.min(from.y, to.y) - Math.abs(to.x - from.x) * 0.35,
  };
  const u = 1 - t;
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  };
}
