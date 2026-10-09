'use client';

import Link from 'next/link';
import { CHANGELOG, type Entry, type Feature } from './changelog.ts';
import { Chapter, ChapterTitle } from './chapter.tsx';
import { Reveal } from './motion.tsx';

/**
 * What is new and usable, on the landing page.
 *
 * Only changelog entries that ship something end to end -- a screen, the API
 * behind it, and the data under that -- appear here, each with where to find
 * it and what every layer does. Measurements, hardening and experiments
 * stay on the What's new page, where there is room to say how each was
 * checked without burying the features.
 */

type Shipped = Entry & { feature: Feature };

const SHIPPED: readonly Shipped[] = CHANGELOG.filter(
  (entry): entry is Shipped => entry.feature !== undefined,
);

function FeatureRow({ entry, index }: { entry: Shipped; index: number }) {
  return (
    <li className="border-b border-white/10">
      <Reveal
        delay={index * 70}
        className="grid gap-6 py-[clamp(1.75rem,4vh,2.75rem)] lg:grid-cols-12 lg:gap-10"
      >
        <div className="lg:col-span-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-faint">
            <time dateTime={entry.date}>{entry.date}</time> · {entry.area}
          </p>
          <h3 className="mt-3 text-[clamp(1.6rem,2.8vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-content">
            {entry.feature.name}
          </h3>
          <p className="mt-4 max-w-[48ch] text-base leading-relaxed text-muted">{entry.summary}</p>
          <p className="mt-4 text-sm text-faint">
            <span className="text-muted">Try it. </span>
            {entry.feature.where}
          </p>
        </div>

        <div className="lg:col-span-7">
          <ol className="space-y-3">
            {entry.feature.layers.map((layer) => {
              const [label, ...rest] = layer.split(': ');
              return (
                <li
                  key={layer}
                  className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-4 border-l-2 border-accent/40 pl-4 text-sm leading-relaxed"
                >
                  <span className="font-medium text-content">{label}</span>
                  <span className="text-muted">{rest.join(': ')}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 text-sm leading-relaxed text-faint">
            <span className="text-muted">How it was checked. </span>
            {entry.checked}
          </p>
        </div>
      </Reveal>
    </li>
  );
}

export function ShippedFeatures() {
  if (SHIPPED.length === 0) return null;

  return (
    <Chapter>
      <ChapterTitle aside="Each one works from the screen to the database. Where to find it, what every layer does, and how it was checked.">
        New, and working end to end.
      </ChapterTitle>

      <ul className="mt-[clamp(2.5rem,6vh,4.5rem)] border-t border-white/10">
        {SHIPPED.map((entry, index) => (
          <FeatureRow key={entry.title} entry={entry} index={index} />
        ))}
      </ul>

      <Link
        href="/whats-new"
        className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-accent-soft transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        Everything that changed, including what was measured and not adopted
        <span aria-hidden="true">→</span>
      </Link>
    </Chapter>
  );
}
