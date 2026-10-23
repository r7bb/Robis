/**
 * The plain parts of the home's hero, kept apart from React so they can be
 * tested: the activity river's stacking and band shapes, and the aurora's
 * colours of the hour.
 */

export type Series = { id: string; values: readonly number[] };
export type Stacked = { id: string; lower: number[]; upper: number[] };

/** Each workspace's band sits on top of the ones before it, day by day. */
export function stackSeries(series: readonly Series[]): Stacked[] {
  const floor = Array<number>(series[0]?.values.length ?? 0).fill(0);
  return series.map((s) => {
    const lower = [...floor];
    const upper = s.values.map((v, i) => lower[i]! + v);
    upper.forEach((v, i) => {
      floor[i] = v;
    });
    return { id: s.id, lower, upper };
  });
}

/**
 * A smooth line through points, with each curve's handles kept level with
 * its ends, so it never overshoots above a peak or below zero.
 */
function smoothLine(points: readonly (readonly [number, number])[], move: boolean): string {
  let d = '';
  points.forEach(([x, y], i) => {
    if (i === 0) {
      d += `${move ? 'M' : 'L'}${x},${y}`;
      return;
    }
    const [px, py] = points[i - 1]!;
    const mid = (px + x) / 2;
    d += ` C${mid},${py} ${mid},${y} ${x},${y}`;
  });
  return d;
}

/**
 * The SVG path of one band, in a box `height` tall where 0 is the top and
 * values run from 0 up to `height`: along the band's top, back along its
 * bottom, closed.
 */
export function areaPath(
  xs: readonly number[],
  upper: readonly number[],
  lower: readonly number[],
  height: number,
): string {
  const top = xs.map((x, i) => [x, height - upper[i]!] as const);
  const bottom = xs.map((x, i) => [x, height - lower[i]!] as const).reverse();
  return `${smoothLine(top, true)} ${smoothLine(bottom, false)} Z`;
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

/** The SVG path of a band's top edge alone, for its outline. */
export function topPath(xs: readonly number[], upper: readonly number[], height: number): string {
  return smoothLine(
    xs.map((x, i) => [x, height - upper[i]!] as const),
    true,
  );
}
