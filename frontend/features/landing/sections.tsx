'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Counter, Reveal } from './motion.tsx';
import { useActiveStep } from './use-scroll.ts';

/**
 * The landing page, as a stack of full-bleed bands.
 *
 * Modelled on apple.com after rendering it and reading its structure: each
 * band is one idea, centred, with an enormous headline, a subhead of a few
 * words, two pill buttons, and the product filling the rest. The copy is
 * radically shorter than it was -- that restraint is most of the effect,
 * and it is the part easiest to lose.
 *
 * Two deliberate departures. The bands stay dark and vary in darkness
 * rather than alternating black and near-white, because the product is
 * dark and a white band would misrepresent it. And the colour accents
 * stay, because Relay has no studio photography to carry a band alone.
 *
 * This also overrides the house rule against centred heroes. That rule
 * exists to stop a centred H1 being the lazy default; here it is the
 * reference being matched.
 */

export const REPO = 'https://github.com/r7bb/Relay';

/** Band backgrounds, darkest first. Adjacent bands never repeat. */
const BANDS = {
  black: 'bg-[#08090c]',
  base: 'bg-[#0e1014]',
  raised: 'bg-[#14171d]',
} as const;

const FILLED =
  'inline-flex items-center justify-center rounded-full bg-accent px-7 py-3 text-base font-medium text-accent-contrast transition-[background-color,transform] duration-[var(--quick)] ease-[var(--ease)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-4 focus-visible:ring-offset-surface active:scale-[0.98]';

const OUTLINED =
  'inline-flex items-center justify-center rounded-full border border-accent-soft/50 px-7 py-3 text-base font-medium text-accent-soft transition-[background-color,border-color,transform] duration-[var(--quick)] ease-[var(--ease)] hover:border-accent-soft hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-4 focus-visible:ring-offset-surface active:scale-[0.98]';

/**
 * One full-bleed band.
 *
 * `min-h`, not a fixed height: a band must grow for a tall screenshot
 * rather than clip it, and on a phone the content decides the height.
 * `svh` rather than `vh` so mobile browser chrome does not push the bottom
 * of each band out of view.
 */
function Band({
  tone,
  children,
  className = '',
}: {
  tone: keyof typeof BANDS;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex min-h-[86svh] flex-col items-center justify-center overflow-hidden px-6 py-24 text-center ${BANDS[tone]} ${className}`}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

/** The headline every band shares: huge, tight, two lines at most. */
function Headline({ children }: { children: ReactNode }) {
  return (
    <h2 className="mx-auto max-w-[14ch] text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.03em] text-content sm:text-6xl lg:text-7xl">
      {children}
    </h2>
  );
}

/** A few words, never a paragraph. */
function Subhead({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-5 max-w-[32ch] text-xl font-medium text-muted sm:text-2xl">
      {children}
    </p>
  );
}

function Shot({
  src,
  alt,
  priority,
  className = '',
}: {
  src: string;
  alt: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={1440}
      height={900}
      priority={priority}
      sizes="(max-width: 1024px) 100vw, 1100px"
      className={`w-full rounded-2xl border border-white/10 shadow-2xl shadow-black/60 ${className}`}
    />
  );
}

export function Hero({ href, label }: { href: string; label: string }) {
  return (
    <Band tone="black" className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] bg-[radial-gradient(55%_55%_at_50%_0%,rgb(var(--accent)/0.3),transparent_72%)]"
      />

      <div className="relative">
        <Reveal>
          <h1 className="mx-auto max-w-[12ch] text-balance text-6xl font-semibold leading-[1] tracking-[-0.035em] text-content sm:text-7xl lg:text-8xl">
            Relay
          </h1>
        </Reveal>

        <Reveal delay={70}>
          <p className="mx-auto mt-4 text-2xl font-medium text-muted sm:text-3xl">Never offline.</p>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link href={href} className={FILLED}>
              {label}
            </Link>
            <a href={`${REPO}#architecture`} className={OUTLINED}>
              How it works
            </a>
          </div>
        </Reveal>

        <Reveal delay={210} className="mt-16">
          <Shot
            src="/shots/workspace.png"
            alt="The Relay workspace: channels and team on the left, a conversation in the middle, projects on the right."
            priority
          />
        </Reveal>
      </div>
    </Band>
  );
}

const OFFLINE_STEPS = [
  {
    kicker: 'Online',
    title: 'File it.',
    shot: '/shots/board.png',
    alt: 'The issue board with a live connection, everything synced.',
    tint: 'text-sky-300',
  },
  {
    kicker: 'Offline',
    title: 'Keep working.',
    shot: '/shots/offline.png',
    alt: 'The board with the network disabled, showing unsynced changes.',
    tint: 'text-amber-300',
  },
  {
    kicker: 'Reconnected',
    title: 'Nothing lost.',
    shot: '/shots/reconnected.png',
    alt: 'The same board after reconnecting, every queued change applied.',
    tint: 'text-emerald-300',
  },
] as const;

/**
 * The one scroll-told band.
 *
 * A sticky stage with a spacer per step scrolling past it. The only place
 * on the page where motion does real work: the reader is walked through
 * three states of one board in order, and the order is the explanation.
 */
export function OfflineStory() {
  const [refs, active] = useActiveStep(OFFLINE_STEPS.length);
  const step = OFFLINE_STEPS[active] ?? OFFLINE_STEPS[0];

  return (
    <section className={`relative ${BANDS.base}`}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="hidden lg:block">
          <div className="sticky top-0 flex h-svh flex-col items-center justify-center py-16 text-center">
            <p
              className={`text-sm font-semibold uppercase tracking-[0.22em] transition-colors duration-[var(--entrance)] ease-[var(--ease)] ${step.tint}`}
            >
              {step.kicker}
            </p>

            <Headline>{step.title}</Headline>

            <div className="relative mt-10 w-full">
              {OFFLINE_STEPS.map((item, index) => (
                <div
                  key={item.kicker}
                  data-frame=""
                  data-active={index === active}
                  // Stacked, so a cross-fade is two opacities rather than a
                  // layout change. The first holds the height.
                  className={index === 0 ? 'relative' : 'absolute inset-0'}
                >
                  <Shot src={item.shot} alt={item.alt} />
                </div>
              ))}
            </div>
          </div>

          {/* Scroll distance: one viewport per step after the first. */}
          {OFFLINE_STEPS.map((item, index) => (
            <div
              key={item.kicker}
              ref={refs[index]}
              className={index === 0 ? 'h-0' : 'h-svh'}
              aria-hidden="true"
            />
          ))}
        </div>

        {/* Below `lg` there is no room to pin anything, so the steps stack. */}
        <div className="space-y-20 py-24 text-center lg:hidden">
          {OFFLINE_STEPS.map((item) => (
            <Reveal key={item.kicker}>
              <p className={`text-sm font-semibold uppercase tracking-[0.22em] ${item.tint}`}>
                {item.kicker}
              </p>
              <Headline>{item.title}</Headline>
              <div className="mt-8">
                <Shot src={item.shot} alt={item.alt} />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const MEASUREMENTS = [
  { value: 6.4, decimals: 1, suffix: ' ms', label: 'to read a board' },
  { value: 4400, decimals: 0, suffix: '', label: 'requests a second' },
  { value: 5.8, decimals: 1, suffix: ' ms', label: 'to reach everyone' },
] as const;

export function Measurements() {
  return (
    <Band tone="raised">
      <Reveal>
        <Headline>Measured, not claimed.</Headline>
        <Subhead>Every number here comes from the benchmark in the repository.</Subhead>
      </Reveal>

      <div className="mt-20 grid gap-12 sm:grid-cols-3">
        {MEASUREMENTS.map((item, index) => (
          <Reveal key={item.label} delay={index * 90}>
            <p className="font-mono text-5xl font-semibold tracking-tight text-amber-200 sm:text-6xl">
              <Counter value={item.value} decimals={item.decimals} suffix={item.suffix} />
            </p>
            <p className="mt-3 text-base text-muted">{item.label}</p>
          </Reveal>
        ))}
      </div>
    </Band>
  );
}

export function Documents() {
  return (
    <Band tone="base">
      <Reveal>
        <Headline>Two cursors. One paragraph.</Headline>
        <Subhead>CRDTs, so edits merge instead of overwriting.</Subhead>
      </Reveal>

      <Reveal delay={120} className="mt-14">
        <Shot src="/shots/document.png" alt="Two people editing the same document at once." />
      </Reveal>
    </Band>
  );
}

const CAPABILITIES = [
  { title: 'Channels', body: 'Rooms with history and moderation.', tint: 'text-sky-300' },
  { title: 'Meetings', body: 'Schedule, invite, answer.', tint: 'text-emerald-300' },
  { title: 'Four roles', body: 'One matrix. 404, never 403.', tint: 'text-rose-300' },
  { title: 'Search', body: 'Issues, documents and comments.', tint: 'text-violet-300' },
] as const;

export function Capabilities() {
  return (
    <Band tone="raised">
      <Reveal>
        <Headline>And the rest of the work.</Headline>
      </Reveal>

      <div className="mt-20 grid gap-14 sm:grid-cols-2 lg:grid-cols-4">
        {CAPABILITIES.map((item, index) => (
          <Reveal key={item.title} delay={index * 80}>
            <h3 className={`text-2xl font-semibold tracking-tight ${item.tint}`}>{item.title}</h3>
            <p className="mt-2 text-base text-muted">{item.body}</p>
          </Reveal>
        ))}
      </div>
    </Band>
  );
}

const DECISIONS = [
  {
    choice: 'Postgres LISTEN/NOTIFY',
    reason: 'The event commits with the write, so it cannot describe a change that rolled back.',
  },
  {
    choice: 'SKIP LOCKED, not a broker',
    reason: 'Jobs enqueue in the same transaction as the work that causes them.',
  },
  {
    choice: 'Keyset, not OFFSET',
    reason: 'OFFSET shifts under concurrent inserts, so readers skip rows and repeat others.',
  },
  {
    choice: 'Sessions, not JWTs',
    reason: 'A session dies when the password changes. A signed token does not.',
  },
] as const;

export function Decisions() {
  return (
    <Band tone="base">
      <Reveal>
        <Headline>The why is the interesting half.</Headline>
      </Reveal>

      <dl className="mx-auto mt-20 grid max-w-4xl gap-x-14 gap-y-12 text-left sm:grid-cols-2">
        {DECISIONS.map((decision, index) => (
          <Reveal key={decision.choice} delay={index * 70}>
            <dt className="text-lg font-semibold text-content">{decision.choice}</dt>
            <dd className="mt-2 text-base leading-relaxed text-muted">{decision.reason}</dd>
          </Reveal>
        ))}
      </dl>
    </Band>
  );
}

export function Closing({ href, label }: { href: string; label: string }) {
  return (
    <Band tone="black" className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(55%_90%_at_50%_100%,rgb(var(--accent)/0.26),transparent_72%)]"
      />

      <Reveal className="relative">
        <Headline>Read it. Run it.</Headline>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link href={href} className={FILLED}>
            {label}
          </Link>
          <a href={REPO} className={OUTLINED}>
            Source on GitHub
          </a>
        </div>
      </Reveal>
    </Band>
  );
}
