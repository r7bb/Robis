'use client';

import { type PointerEvent, useEffect, useId, useRef, useState } from 'react';
import { useReducedMotion } from '../landing/use-scroll.ts';
import { dayOf } from './activity-spark.tsx';
import type { SparkSignal } from './describe.ts';
import { areaPath, stackSeries, topPath } from './hero-scene.ts';

export type RiverSeries = {
  id: string;
  name: string;
  /** Its theme's accent, as `r g b`. */
  accent: string;
  /** Fourteen days, oldest first. */
  values: readonly number[];
};

const W = 600;
const H = 160;
/** Headroom above the busiest day, so its crest is not clipped. */
const HEADROOM = 0.88;
const RIPPLE_MS = 1300;

/**
 * Two weeks of your team's activity as a river: one band per workspace in
 * its theme's colour, stacked, so you can see when the team was busy and
 * where. Hover a day for its counts. A live event sends a ripple out from
 * today's edge of its workspace's band, and the band grows as the counts
 * refresh. Offline, it greys. Still under reduced motion.
 */
export function ActivityRiver({
  series,
  spark,
  offline,
}: {
  series: readonly RiverSeries[];
  spark: SparkSignal | null;
  offline: boolean;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState<number | null>(null);
  const [ripple, setRipple] = useState<{ seq: number; top: number; accent: string } | null>(null);

  const days = series[0]?.values.length ?? 14;
  const stacked = stackSeries(series);
  const tops = stacked.at(-1)?.upper ?? Array<number>(days).fill(0);
  const peak = Math.max(1, ...tops);
  const scale = (v: number) => (v / peak) * H * HEADROOM;
  const xs = Array.from({ length: days }, (_, i) => (i / (days - 1)) * W);
  const total = tops.reduce((sum, n) => sum + n, 0);

  // Read by the ripple effect, which runs on a new event, not on new data.
  const latest = useRef({ stacked, series, scale });
  latest.current = { stacked, series, scale };

  // A ripple from today's edge of the event's band, as a share of the height.
  useEffect(() => {
    if (!spark || reduced) return;
    const { stacked: bands, series: all, scale: toHeight } = latest.current;
    const band = bands.find((s) => s.id === spark.workspaceId);
    const at = all.find((s) => s.id === spark.workspaceId);
    if (!band || !at) return;
    const top = 1 - toHeight(band.upper.at(-1) ?? 0) / H;
    setRipple({ seq: spark.seq, top: Math.min(0.96, top), accent: at.accent });
    const timer = setTimeout(() => setRipple(null), RIPPLE_MS);
    return () => clearTimeout(timer);
  }, [spark, reduced]);

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - box.left) / box.width;
    setHovered(Math.max(0, Math.min(days - 1, Math.round(share * (days - 1)))));
  };

  const summary =
    total === 0
      ? `No activity in the last ${days} days`
      : `Activity over the last ${days} days: ${series
          .map((s) => `${s.name} ${s.values.reduce((a, b) => a + b, 0)}`)
          .join(', ')}`;

  return (
    <div
      className={`home-river transition-[filter,opacity] duration-500 ${offline ? 'opacity-50 grayscale' : ''}`}
    >
      <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHovered(null)}>
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-36 w-full overflow-visible sm:h-44"
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.id} id={`${id}-${s.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`rgb(${s.accent})`} stopOpacity="0.85" />
                <stop offset="100%" stopColor={`rgb(${s.accent})`} stopOpacity="0.2" />
              </linearGradient>
            ))}
          </defs>
          <line
            x1="0"
            y1={H}
            x2={W}
            y2={H}
            className="stroke-line"
            vectorEffect="non-scaling-stroke"
          />
          {stacked.map((band, i) => (
            <g key={band.id} className="home-river-band" style={{ animationDelay: `${i * 90}ms` }}>
              <path
                d={areaPath(xs, band.upper.map(scale), band.lower.map(scale), H)}
                fill={`url(#${id}-${band.id})`}
              />
              <path
                d={topPath(xs, band.upper.map(scale), H)}
                fill="none"
                stroke={`rgb(${series[i]!.accent})`}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}
        </svg>

        {total === 0 && (
          <p className="absolute inset-x-0 bottom-6 text-center text-sm text-faint">
            A quiet two weeks. Activity in your workspaces flows in here.
          </p>
        )}

        {ripple && (
          <span
            key={ripple.seq}
            aria-hidden="true"
            className="home-ripple pointer-events-none absolute right-0 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full border-2"
            style={{ top: `${ripple.top * 100}%`, borderColor: `rgb(${ripple.accent})` }}
          />
        )}

        {hovered !== null && total > 0 && (
          <RiverTooltip index={hovered} days={days} series={series} />
        )}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>Two weeks ago</span>
        <span>Today</span>
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-xs text-muted">
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: `rgb(${s.accent})` }}
            />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The day under the pointer: a line through it and each workspace's count. */
function RiverTooltip({
  index,
  days,
  series,
}: {
  index: number;
  days: number;
  series: readonly RiverSeries[];
}) {
  const left = (index / (days - 1)) * 100;
  const day = series.reduce((sum, s) => sum + (s.values[index] ?? 0), 0);
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0"
      style={{ left: `${left}%` }}
    >
      <div className="absolute inset-y-0 w-px bg-content/30" />
      <div
        className={`absolute top-0 w-max rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow-[0_8px_24px_rgb(8_9_12/0.5)] ${left > 60 ? 'right-2' : 'left-2'}`}
      >
        <div className="font-medium text-content">
          {dayOf(index, days)}: {day} {day === 1 ? 'change' : 'changes'}
        </div>
        {series.map((s) => (
          <div key={s.id} className="mt-1 flex items-center gap-2 text-muted">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: `rgb(${s.accent})` }} />
            <span className="min-w-16">{s.name}</span>
            <span className="ml-auto text-content">{s.values[index] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
