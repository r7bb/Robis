'use client';

import Link from 'next/link';
import { FILLED, OUTLINED } from './band.tsx';
import { Chapter, ChapterTitle } from './chapter.tsx';
import { Field } from './field.tsx';
import { LiveParagraph } from './live-paragraph.tsx';
import { Reveal } from './motion.tsx';
import { StackMarquee } from './stack.tsx';
import { useInView } from './use-scroll.ts';

/**
 * The chapters after the hero.
 *
 * Each used to be a centred band on its own grey, with its own label
 * colours, and by the fourth one the page read as a template. They are now
 * chapters of one document (see `chapter.tsx`): the hero's near-black, its
 * grid, its single accent, and a section that shows something live
 * wherever there is something live to show.
 */

export const REPO = 'https://github.com/r7bb/Robis';

/** What actually happens when two people type in one place. */
const MERGE_STEPS = [
  { who: 'You', tint: 'text-accent-soft', body: 'type into the middle of the sentence.' },
  { who: 'Mia', tint: 'text-emerald-300', body: 'types onto the end of it, at the same moment.' },
  {
    who: 'Both',
    tint: 'text-content',
    body: 'end up with the same document. No lock, no winner, no lost keystroke.',
  },
] as const;

export function Documents() {
  return (
    <Chapter>
      <div className="grid items-center gap-[clamp(2.5rem,5vw,5rem)] lg:grid-cols-12">
        <div className="lg:col-span-5">
          <ChapterTitle>Two cursors. One paragraph.</ChapterTitle>

          <Reveal delay={160}>
            <dl className="mt-9 space-y-5">
              {MERGE_STEPS.map((step) => (
                <div key={step.who} className="flex gap-3">
                  <dt className={`w-12 shrink-0 text-base font-semibold ${step.tint}`}>
                    {step.who}
                  </dt>
                  <dd className="text-base leading-relaxed text-muted">{step.body}</dd>
                </div>
              ))}
            </dl>
          </Reveal>

          <Reveal delay={240}>
            <p className="mt-8 max-w-[46ch] text-sm leading-relaxed text-faint">
              Yjs CRDTs over a WebSocket gateway. Convergence is a property of the data structure,
              not of who reached the server first, which is why it still works after an hour
              offline.
            </p>
          </Reveal>
        </div>

        <Reveal delay={120} className="lg:col-span-7">
          <LiveParagraph />
        </Reveal>
      </div>
    </Chapter>
  );
}

const CAPABILITIES = [
  { title: 'Channels', body: 'Rooms with history, day separators and moderation.' },
  { title: 'Meetings', body: 'Schedule, invite and answer. Moving the time clears every yes.' },
  { title: 'Four roles', body: 'One permission matrix. A stranger gets a 404, never a 403.' },
  { title: 'Search', body: 'Issues, documents and comments, through Postgres full-text search.' },
] as const;

/**
 * Large rows rather than four small coloured labels. The titles carry the
 * weight; the rule between rows keeps the list readable as one thing.
 */
export function Capabilities() {
  return (
    <Chapter>
      <ChapterTitle>And the rest of the work.</ChapterTitle>

      <ul className="mt-[clamp(2.5rem,6vh,4.5rem)] border-t border-white/10">
        {CAPABILITIES.map((item, index) => (
          // The `li` stays the list's direct child, so the list is still a
          // list to assistive technology; the reveal goes inside it.
          <li key={item.title} className="border-b border-white/10">
            <Reveal
              delay={index * 70}
              className="grid gap-2 py-[clamp(1.25rem,3vh,2rem)] sm:grid-cols-12 sm:items-baseline sm:gap-8"
            >
              <p className="text-[clamp(1.6rem,3vw,2.75rem)] font-semibold leading-none tracking-[-0.035em] text-content sm:col-span-5">
                {item.title}
              </p>
              <p className="text-base leading-relaxed text-muted sm:col-span-7 sm:text-lg">
                {item.body}
              </p>
            </Reveal>
          </li>
        ))}
      </ul>
    </Chapter>
  );
}

/** Each from the README's "instead of" table, so the rejected option is real. */
const DECISIONS = [
  {
    instead: 'Redis pub/sub',
    choice: 'Postgres LISTEN/NOTIFY',
    reason: 'The event commits with the write, so it cannot describe a change that rolled back.',
  },
  {
    instead: 'A queue broker',
    choice: 'SKIP LOCKED',
    reason: 'Jobs enqueue in the same transaction as the work that causes them.',
  },
  {
    instead: 'OFFSET',
    choice: 'Keyset pagination',
    reason: 'OFFSET shifts under concurrent inserts, so readers skip rows and repeat others.',
  },
  {
    instead: 'JWTs',
    choice: 'Opaque sessions',
    reason: 'A session dies the moment a password changes. A signed token does not.',
  },
  {
    instead: 'Elasticsearch',
    choice: 'Postgres full-text search',
    reason: 'A stored generated tsvector cannot drift from the row it describes.',
  },
] as const;

export function Decisions() {
  return (
    <Chapter>
      <ChapterTitle aside="Every one of these was a choice against something more familiar. The thing turned down is the interesting part.">
        The why is the interesting half.
      </ChapterTitle>

      <ul className="mt-[clamp(2.5rem,6vh,4.5rem)] border-t border-white/10">
        {DECISIONS.map((decision) => (
          <DecisionRow key={decision.choice} {...decision} />
        ))}
      </ul>
    </Chapter>
  );
}

function DecisionRow({ instead, choice, reason }: (typeof DECISIONS)[number]) {
  const [ref, shown] = useInView<HTMLLIElement>();

  return (
    <li
      ref={ref}
      className="grid gap-2 border-b border-white/10 py-[clamp(1.25rem,3vh,2rem)] lg:grid-cols-12 lg:items-baseline lg:gap-8"
    >
      <p className="text-lg text-faint lg:col-span-3">
        <span className="sr-only">Instead of </span>
        <span data-struck="" data-shown={shown}>
          {instead}
        </span>
        <span className="sr-only">:</span>
      </p>
      <p className="text-[clamp(1.4rem,2.4vw,2.1rem)] font-semibold leading-tight tracking-[-0.03em] text-content lg:col-span-4">
        {choice}
      </p>
      <p className="text-base leading-relaxed text-muted lg:col-span-5">{reason}</p>
    </li>
  );
}

export function Stack() {
  return (
    <Chapter>
      <ChapterTitle aside="No framework doing the hard part. The interesting pieces are the ones that are not here: no Redis, no queue broker, no search cluster.">
        Built with.
      </ChapterTitle>

      <StackMarquee />
    </Chapter>
  );
}

/**
 * The bookend: the name again, over its field, and the two ways in.
 *
 * The page opens with the name alone and now closes with it, so the
 * reader leaves on the same note they arrived on rather than on a button
 * row in a band of colour.
 */
export function Closing({ href, label }: { href: string; label: string }) {
  return (
    <section className="relative isolate grid min-h-[85svh] place-items-center overflow-hidden bg-[#08090c] px-[clamp(1rem,3vw,2.5rem)] py-[clamp(5rem,14vh,10rem)]">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Field mode="merge" pulse={0} />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#08090c,transparent_30%,transparent_80%,#08090c)]" />
      </div>

      <Reveal className="text-center">
        <p
          aria-hidden="true"
          className="select-none pl-[0.34em] text-[clamp(2.25rem,5.5vw,5rem)] font-bold leading-none tracking-[0.34em] text-content"
        >
          ROBIS
        </p>
        <h2 className="mt-[clamp(1.5rem,4vh,2.5rem)] text-[clamp(1.25rem,2vw,1.75rem)] font-medium tracking-[-0.02em] text-muted">
          Read it. Run it.
        </h2>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <Link href={href} className={FILLED}>
            {label}
          </Link>
          <a href={REPO} className={OUTLINED} target="_blank" rel="noopener noreferrer">
            Source on GitHub
          </a>
        </div>
      </Reveal>
    </section>
  );
}
