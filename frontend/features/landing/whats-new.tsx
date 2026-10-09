'use client';

import { useId, useState } from 'react';
import { AREAS, type Area, CHANGELOG } from './changelog.ts';
import { Chapter, ChapterTitle } from './chapter.tsx';

/**
 * What has shipped, newest first, and how each thing was checked.
 *
 * Interactive where it earns it: filter by area, and open an entry to see
 * the evidence behind it. Each row is a real button with `aria-expanded`,
 * so it works the same from a keyboard and a screen reader as it does with
 * a mouse. The data is shared with the README (see `changelog.ts`).
 */
export function WhatsNew({ standalone = false }: { standalone?: boolean }) {
  const [area, setArea] = useState<Area | null>(null);
  const [open, setOpen] = useState<string | null>(CHANGELOG[0]?.title ?? null);
  const baseId = useId();

  const entries = area ? CHANGELOG.filter((entry) => entry.area === area) : CHANGELOG;
  const areas = AREAS.filter((candidate) => CHANGELOG.some((entry) => entry.area === candidate));

  return (
    <Chapter ruled={!standalone}>
      <div className="grid gap-[clamp(2.5rem,5vw,5rem)] lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            {/* On its own page the page's h1 is the title; here it would be a
                second heading saying the same thing. */}
            {standalone ? (
              <p className="max-w-[40ch] text-base leading-relaxed text-muted">
                Everything that has shipped, newest first: features, measurements, and the things
                tried and not adopted. Each entry says how it was checked.
              </p>
            ) : (
              <ChapterTitle aside="Each entry says how it was checked, not just what it does.">
                What is new.
              </ChapterTitle>
            )}

            <fieldset className="mt-8 flex flex-wrap gap-2">
              <legend className="sr-only">Filter by area</legend>
              {[null, ...areas].map((candidate) => (
                <button
                  key={candidate ?? 'all'}
                  type="button"
                  aria-pressed={area === candidate}
                  onClick={() => setArea(candidate)}
                  className={`rounded-full border px-4 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                    area === candidate
                      ? 'border-accent-soft/60 bg-accent/15 text-content'
                      : 'border-white/10 text-muted hover:text-content'
                  }`}
                >
                  {candidate ?? 'Everything'}
                </button>
              ))}
            </fieldset>
          </div>
        </div>

        <ol className="border-t border-white/10 lg:col-span-8">
          {entries.map((entry, index) => {
            const expanded = open === entry.title;
            const panelId = `${baseId}-${index}`;

            return (
              <li key={entry.title} className="border-b border-white/10">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  onClick={() => setOpen(expanded ? null : entry.title)}
                  className="grid w-full grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-4 py-5 text-left transition-colors hover:text-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                >
                  <time dateTime={entry.date} className="font-mono text-xs tabular-nums text-faint">
                    {entry.date}
                  </time>
                  <span>
                    <span className="block text-lg font-medium tracking-[-0.01em] text-content">
                      {entry.title}
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-faint">
                      {entry.area}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-faint">
                    {expanded ? '−' : '+'}
                  </span>
                </button>

                <div id={panelId} hidden={!expanded} className="pb-6 sm:pl-[7.5rem]">
                  <p className="max-w-[62ch] text-base leading-relaxed text-muted">
                    {entry.summary}
                  </p>
                  <p className="mt-3 max-w-[62ch] border-l-2 border-accent/40 pl-4 text-sm leading-relaxed text-faint">
                    <span className="text-muted">How it was checked. </span>
                    {entry.checked}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Chapter>
  );
}
