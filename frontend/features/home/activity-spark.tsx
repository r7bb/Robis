'use client';

import { useState } from 'react';

const BAR_WIDTH = 6;
const GAP = 3;
const HEIGHT = 28;
/** A day with nothing still shows a stub, so the baseline reads as zero. */
const MIN_BAR = 2;

// In UTC, as the server counts the days, so a bar and its label agree.
const dayLabel = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const DAY_MS = 24 * 60 * 60 * 1000;

export function dayOf(index: number, count: number): string {
  if (index === count - 1) return 'Today';
  return dayLabel.format(new Date(Date.now() - (count - 1 - index) * DAY_MS));
}

/**
 * Two weeks of activity as a sparkline: quiet bars for the past, today in
 * the workspace's accent, and the day and count on hover.
 *
 * One series, so no legend. Keyboard and screen-reader users get the total
 * and today's count from its accessible label; the bars themselves are not
 * focusable, so a tile stays one stop in the tab order.
 */
export function ActivitySpark({ days }: { days: readonly number[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const peak = Math.max(1, ...days);
  const width = days.length * (BAR_WIDTH + GAP) - GAP;
  const total = days.reduce((sum, n) => sum + n, 0);
  const label = `${total} ${total === 1 ? 'change' : 'changes'} in the last ${days.length} days, ${days.at(-1) ?? 0} today`;

  return (
    <div className="relative">
      <svg
        role="img"
        aria-label={label}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        onPointerLeave={() => setHovered(null)}
        className="block overflow-visible"
      >
        {days.map((n, i) => {
          const h = Math.max(MIN_BAR, Math.round((n / peak) * HEIGHT));
          const today = i === days.length - 1;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: a day's position is its identity
              key={i}
              x={i * (BAR_WIDTH + GAP)}
              y={HEIGHT - h}
              width={BAR_WIDTH}
              height={h}
              rx={2}
              onPointerEnter={() => setHovered(i)}
              className={
                today
                  ? 'fill-[rgb(var(--tile-accent))]'
                  : hovered === i
                    ? 'fill-muted'
                    : 'fill-faint/35 transition-[fill] duration-150'
              }
            />
          );
        })}
      </svg>
      {hovered !== null && (
        <span className="pointer-events-none absolute -top-6 left-0 whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-content shadow-[0_0_0_1px_rgb(var(--border))]">
          {dayOf(hovered, days.length)}: {days[hovered]}
        </span>
      )}
    </div>
  );
}
