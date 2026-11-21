'use client';

import { useState } from 'react';
import { throughputLabel, weekEnding, weekLines } from './flow-model.ts';

const BAR_WIDTH = 14;
const GAP = 4;
const HEIGHT = 44;
/** A week with nothing still shows a stub, so the baseline reads as zero. */
const MIN_BAR = 2;

/**
 * Twelve weeks of finished issues, oldest on the left: quiet bars for the
 * past, the last seven days in the accent, and the week and count on hover.
 *
 * One series, so no legend. Screen-reader users get the total and the last
 * week from the accessible label, then every week in a list read out after
 * it; the bars are not focusable, so a card stays one stop in the tab order.
 */
export function ThroughputBars({
  counts,
  since,
}: {
  counts: readonly number[];
  since: string | Date;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const peak = Math.max(1, ...counts);
  const width = counts.length * (BAR_WIDTH + GAP) - GAP;

  return (
    <figure className="relative m-0">
      <svg
        role="img"
        aria-label={throughputLabel(counts)}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        onPointerLeave={() => setHovered(null)}
        className="block overflow-visible"
      >
        {counts.map((n, i) => {
          const h = Math.max(MIN_BAR, Math.round((n / peak) * HEIGHT));
          const latest = i === counts.length - 1;
          return (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: a week's position is its identity
              key={i}
              x={i * (BAR_WIDTH + GAP)}
              y={HEIGHT - h}
              width={BAR_WIDTH}
              height={h}
              rx={3}
              onPointerEnter={() => setHovered(i)}
              className={
                latest
                  ? 'fill-accent'
                  : hovered === i
                    ? 'fill-muted'
                    : 'fill-faint/35 transition-[fill] duration-150 motion-reduce:transition-none'
              }
            />
          );
        })}
      </svg>
      <ol className="sr-only">
        {weekLines(counts, since).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <figcaption className="mt-1.5 flex justify-between text-[11px] text-faint" aria-hidden="true">
        <span>{counts.length} weeks ago</span>
        <span>Last 7 days</span>
      </figcaption>
      {hovered !== null && (
        <span className="pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-[11px] tabular-nums text-content shadow-[0_0_0_1px_rgb(var(--border))]">
          Week to {weekEnding(since, hovered)}: {counts[hovered]} finished
        </span>
      )}
    </figure>
  );
}
