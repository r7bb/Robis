'use client';

import { contracts, evenPace } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import { dateFormat } from '../../lib/i18n/format.ts';
import { burnUpLine, cycleLength } from './burn-up-model.ts';
import { addDays } from './cycle-days.ts';

const WIDTH = 320;
const HEIGHT = 72;
/** Room above the top line, so the last marker is not clipped. */
const HEAD = 6;

const dayName = (day: string) =>
  dateFormat({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00`));

/** The browser's own zone, so a day ends where the person is. */
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * A cycle's burn-up: done by the end of each day so far, in the accent,
 * against a quiet dashed line of an even pace to all of it by the last
 * day. One series and a reference line named in the caption, so no legend.
 * Hovering a day says its count; screen readers get the sentence and then
 * every day in a list.
 */
export function BurnUpChart({ workspaceId, cycleId }: { workspaceId: string; cycleId: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const burn = useQuery({
    queryKey: ['cycle-burnup', workspaceId, cycleId],
    queryFn: () =>
      call(contracts['cycles.burnup'], {
        params: { workspaceId, cycleId },
        query: { timeZone: zone() },
      }),
  });
  if (!burn.data) {
    return <div aria-hidden="true" className="mt-2 h-[72px] animate-pulse rounded bg-surface" />;
  }
  const { startsOn, endsOn, planned, done } = burn.data;
  const days = cycleLength(startsOn, endsOn);
  const pace = evenPace(planned, days);
  const top = Math.max(1, planned, ...done);
  const x = (i: number) => ((i + 1) / days) * WIDTH;
  const y = (n: number) => HEAD + (1 - n / top) * (HEIGHT - HEAD);
  const line = burnUpLine(done, planned, days);
  const shown = hovered ?? done.length - 1;

  return (
    <figure className="m-0 mt-2">
      <div className="relative">
        <svg
          role="img"
          aria-label={line}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          onPointerLeave={() => setHovered(null)}
          className="block h-[72px] w-full overflow-visible"
        >
          <line
            x1={0}
            y1={HEIGHT}
            x2={WIDTH}
            y2={HEIGHT}
            className="stroke-line"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={[`0,${HEIGHT}`, ...pace.map((n, i) => `${x(i)},${y(n)}`)].join(' ')}
            fill="none"
            strokeDasharray="3 4"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            className="stroke-faint"
          />
          {done.length > 0 ? (
            <polyline
              points={[`0,${y(0)}`, ...done.map((n, i) => `${x(i)},${y(n)}`)].join(' ')}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-accent"
            />
          ) : null}
          {done.map((_, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: a day's position is its identity
              key={i}
              x={x(i) - WIDTH / days}
              y={0}
              width={WIDTH / days}
              height={HEIGHT}
              fill="transparent"
              onPointerEnter={() => setHovered(i)}
            />
          ))}
        </svg>
        {shown >= 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-0 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-raised"
            style={{
              left: `${(x(shown) / WIDTH) * 100}%`,
              top: `${(y(done[shown] ?? 0) / HEIGHT) * 100}%`,
            }}
          />
        ) : null}
      </div>
      <figcaption className="mt-1 flex flex-wrap justify-between gap-x-3 text-[11px] text-faint">
        <span>
          {hovered === null
            ? line
            : `${dayName(addDays(startsOn, hovered))}: ${done[hovered]} of ${planned} done`}
        </span>
        <span aria-hidden="true">Dashed: an even pace</span>
      </figcaption>
      <ul className="sr-only">
        {done.map((n, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a day's position is its identity
          <li key={i}>
            {dayName(addDays(startsOn, i))}: {n} done
          </li>
        ))}
      </ul>
    </figure>
  );
}
