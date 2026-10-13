'use client';

import { type CSSProperties, useId, useState } from 'react';
import { AREAS, type Area, CHANGELOG, type Entry } from './changelog.ts';
import { Chapter, ChapterTitle } from './chapter.tsx';

/**
 * What has shipped, newest first, and how each thing was checked.
 *
 * Interactive where it earns it: filter by area, and open an entry to see
 * the evidence behind it. Each row is a real button with `aria-expanded`,
 * so it works the same from a keyboard and a screen reader as it does with
 * a mouse. The data is shared with the README (see `changelog.ts`).
 *
 * The motion lives in CSS (`[data-entry-*]` in globals.css): panels unfold
 * to their natural height, the icon morphs, and a filter change lets the
 * list settle in. A closed panel stays in the DOM so it can animate, and is
 * `inert` so nothing inside it takes focus or is read out.
 */
export function WhatsNew({ standalone = false }: { standalone?: boolean }) {
  const [area, setArea] = useState<Area | null>(null);
  const [open, setOpen] = useState<string | null>(CHANGELOG[0]?.title ?? null);
  const baseId = useId();

  const entries = area ? CHANGELOG.filter((entry) => entry.area === area) : CHANGELOG;
  const areas = AREAS.filter((candidate) => CHANGELOG.some((entry) => entry.area === candidate));
  const countFor = (candidate: Area | null) =>
    candidate ? CHANGELOG.filter((entry) => entry.area === candidate).length : CHANGELOG.length;

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
                <FilterChip
                  key={candidate ?? 'all'}
                  label={candidate ?? 'Everything'}
                  count={countFor(candidate)}
                  selected={area === candidate}
                  onSelect={() => setArea(candidate)}
                />
              ))}
            </fieldset>
          </div>
        </div>

        {/* Keyed by the filter, so a change re-runs the staggered entrance
            rather than swapping rows in place. */}
        <ol
          key={area ?? 'all'}
          data-entry-list=""
          className="border-t border-white/10 lg:col-span-8"
        >
          {entries.map((entry, index) => (
            <EntryRow
              key={entry.title}
              entry={entry}
              index={index}
              panelId={`${baseId}-${index}`}
              expanded={open === entry.title}
              onToggle={() => setOpen(open === entry.title ? null : entry.title)}
            />
          ))}
        </ol>
      </div>
    </Chapter>
  );
}

function FilterChip({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-[color,background-color,border-color,transform] duration-[var(--micro)] ease-[var(--ease)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
        selected
          ? 'border-accent-soft/60 bg-accent/15 text-content'
          : 'border-white/10 text-muted hover:border-white/20 hover:text-content'
      }`}
    >
      {label}
      <span
        className={`font-mono text-[11px] tabular-nums transition-colors duration-[var(--micro)] ${selected ? 'text-accent-soft' : 'text-faint'}`}
      >
        {count}
      </span>
    </button>
  );
}

function EntryRow({
  entry,
  index,
  panelId,
  expanded,
  onToggle,
}: {
  entry: Entry;
  index: number;
  panelId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      data-entry-row=""
      data-open={expanded}
      style={{ '--entry-index': index } as CSSProperties}
      className="border-b border-white/10"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1.5 py-5 sm:grid-cols-[6.5rem_minmax(0,1fr)_auto] sm:gap-y-0 pl-4 pr-1 text-left transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:bg-white/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft"
      >
        {/* Above the title on a phone, in its own column from `sm` up. */}
        <time
          dateTime={entry.date}
          className="col-start-1 row-start-1 font-mono text-xs tabular-nums text-faint"
        >
          {entry.date}
        </time>
        <span className="col-start-1 row-start-2 sm:col-start-2 sm:row-start-1">
          <span
            className={`block text-lg font-medium tracking-[-0.01em] transition-colors duration-[var(--micro)] ease-[var(--ease)] ${expanded ? 'text-content' : 'text-content/85 group-hover:text-content'}`}
          >
            {entry.title}
          </span>
          <span className="mt-1 block text-xs uppercase tracking-[0.14em] text-faint">
            {entry.area}
          </span>
        </span>
        <span
          aria-hidden="true"
          data-entry-icon=""
          className={`col-start-2 row-span-2 row-start-1 self-center transition-colors duration-[var(--micro)] sm:col-start-3 sm:row-span-1 ${expanded ? 'text-accent-soft' : 'text-faint group-hover:text-muted'}`}
        />
      </button>

      <div id={panelId} data-entry-panel="" data-open={expanded} inert={!expanded}>
        <div>
          <EntryBody entry={entry} />
        </div>
      </div>
    </li>
  );
}

function EntryBody({ entry }: { entry: Entry }) {
  return (
    <div data-entry-body="" className="pb-7 pl-4 sm:pl-[8.5rem]">
      <p className="max-w-[62ch] text-base leading-relaxed text-muted">{entry.summary}</p>
      {entry.feature ? (
        <div className="mt-5 max-w-[62ch]">
          <p className="text-sm text-faint">
            <span className="text-muted">Try it. </span>
            {entry.feature.where}
          </p>
          <dl className="mt-3 space-y-2 text-sm leading-relaxed">
            {entry.feature.layers.map((layer) => {
              const [label, ...rest] = layer.split(': ');
              return (
                <div key={layer} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                  <dt className="font-medium text-content">{label}</dt>
                  <dd className="text-muted">{rest.join(': ')}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ) : null}
      <p className="mt-5 max-w-[62ch] border-l-2 border-accent/40 pl-4 text-sm leading-relaxed text-faint">
        <span className="text-muted">How it was checked. </span>
        {entry.checked}
      </p>
    </div>
  );
}
