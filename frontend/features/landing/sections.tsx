'use client';

import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Counter, Reveal } from './motion.tsx';
import { useActiveStep } from './use-scroll.ts';

/**
 * The landing page, as a stack of full-bleed bands.
 *
 * Structure borrowed from apple.com after rendering it: one idea per band,
 * centred, a large tight headline, a short subhead, two pill buttons, the
 * product filling the rest.
 *
 * Sizing took two attempts. The first version pinned each band to `86svh`
 * and centred the content inside, which looks right on one screen and
 * wrong on every other: tall viewports got bands of empty space, short
 * ones pushed content past the band edge and the sticky screenshot bled
 * into the section below. Nothing here has a fixed height any more.
 * Padding and type scale with `clamp`, bands grow to fit their content,
 * and the one viewport-locked element sizes its image with
 * `object-contain` so it fits whatever space is left over.
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
 * Height comes from the content. The vertical padding scales with the
 * viewport so a band breathes on a large screen without stranding content
 * in the middle of a small one, and there is no `min-height` to overflow.
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
    <section className={`px-6 py-[clamp(4rem,9vh,9rem)] text-center ${BANDS[tone]} ${className}`}>
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

/**
 * The shared headline.
 *
 * `clamp` rather than breakpoint steps: the size moves continuously with
 * the viewport, so there is no width at which it is awkwardly large or
 * suddenly small. `text-balance` keeps a two-line headline from leaving an
 * orphan word on the second line.
 */
function Headline({ children }: { children: ReactNode }) {
  return (
    <h2 className="mx-auto max-w-[16ch] text-balance text-[clamp(2.25rem,5vw,4.5rem)] font-semibold leading-[1.06] tracking-[-0.03em] text-content">
      {children}
    </h2>
  );
}

function Subhead({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-5 max-w-[46ch] text-[clamp(1.05rem,1.6vw,1.4rem)] leading-relaxed text-muted">
      {children}
    </p>
  );
}

/** A screenshot at its natural aspect ratio. */
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
      className={`mx-auto h-auto w-full rounded-xl border border-white/10 shadow-2xl shadow-black/60 ${className}`}
    />
  );
}

export function Hero({ href, label }: { href: string; label: string }) {
  return (
    <Band tone="black" className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(55%_55%_at_50%_0%,rgb(var(--accent)/0.3),transparent_72%)]"
      />

      <div className="relative">
        <Reveal>
          {/*
           * The proposition, not the product name. An earlier version made
           * this "Relay" with "Never offline." underneath, which works for
           * Apple because everyone already knows what an iPhone is. Nobody
           * knows what Relay is, so the first line has to say.
           */}
          <h1 className="mx-auto max-w-[18ch] text-balance text-[clamp(2.5rem,5.5vw,5rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-content">
            Never lose a change.
          </h1>
        </Reveal>

        <Reveal delay={70}>
          <Subhead>
            Issues, documents, chat and meetings that keep working when the network does not.
          </Subhead>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link href={href} className={FILLED}>
              {label}
            </Link>
            <a href={`${REPO}#architecture`} className={OUTLINED}>
              How it works
            </a>
          </div>
        </Reveal>

        {/*
         * The board, not the chat. The chat screenshot is mostly an empty
         * message pane, which at hero size reads as an unfinished product;
         * the board is dense and colourful and shows the work.
         */}
        <Reveal delay={210} className="mt-[clamp(2.5rem,6vh,4.5rem)]">
          <Shot
            src="/shots/board.png"
            alt="The Relay issue board, with a column per status and coloured priority badges."
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
 * The one scroll-told band: three states of one board, in order.
 *
 * The stage is a flex column pinned to the viewport. The caption takes the
 * height it needs and the image takes the rest, sized with `object-contain`
 * inside a `min-h-0 flex-1` box. That combination is what makes it work at
 * any height: on a short laptop the image shrinks, on a tall monitor it
 * grows, and it never pushes past the pinned area into the next band,
 * which is exactly what the previous fixed-height version did.
 */
export function OfflineStory() {
  const [refs, active] = useActiveStep(OFFLINE_STEPS.length);
  const step = OFFLINE_STEPS[active] ?? OFFLINE_STEPS[0];

  return (
    <section className={`relative ${BANDS.base}`}>
      <div className="mx-auto max-w-6xl px-6">
        <div className="hidden lg:block">
          <div className="sticky top-0 flex h-svh flex-col items-center justify-center gap-[clamp(1rem,3vh,2.5rem)] py-[clamp(3rem,8vh,6rem)]">
            <div className="shrink-0">
              <p
                className={`text-sm font-semibold uppercase tracking-[0.22em] transition-colors duration-[var(--entrance)] ease-[var(--ease)] ${step.tint}`}
              >
                {step.kicker}
              </p>
              <Headline>{step.title}</Headline>
            </div>

            <div className="relative min-h-0 w-full flex-1">
              {OFFLINE_STEPS.map((item, index) => (
                <Image
                  key={item.kicker}
                  src={item.shot}
                  alt={item.alt}
                  width={1440}
                  height={900}
                  sizes="1100px"
                  data-frame=""
                  data-active={index === active}
                  // Absolute and `object-contain`: all three stack in one
                  // box, and each fits whatever space is left rather than
                  // dictating the height of the stage.
                  className="absolute inset-0 h-full w-full rounded-xl border border-white/10 object-contain shadow-2xl shadow-black/60"
                />
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
        <div className="space-y-[clamp(3rem,8vh,5rem)] py-[clamp(4rem,9vh,9rem)] text-center lg:hidden">
          {OFFLINE_STEPS.map((item) => (
            <Reveal key={item.kicker}>
              <p className={`text-sm font-semibold uppercase tracking-[0.22em] ${item.tint}`}>
                {item.kicker}
              </p>
              <Headline>{item.title}</Headline>
              <div className="mt-6">
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
        <Subhead>Every number here comes from the benchmark in this repository.</Subhead>
      </Reveal>

      <div className="mt-[clamp(2.5rem,6vh,4rem)] grid gap-10 sm:grid-cols-3">
        {MEASUREMENTS.map((item, index) => (
          <Reveal key={item.label} delay={index * 90}>
            <p className="font-mono text-[clamp(2rem,4vw,3.25rem)] font-semibold tracking-tight text-amber-200">
              <Counter value={item.value} decimals={item.decimals} suffix={item.suffix} />
            </p>
            <p className="mt-2 text-base text-muted">{item.label}</p>
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
        <Subhead>CRDTs over a WebSocket gateway, so edits merge instead of overwriting.</Subhead>
      </Reveal>

      <Reveal delay={120} className="mt-[clamp(2.5rem,6vh,4rem)]">
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

      <div className="mt-[clamp(2.5rem,6vh,4rem)] grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        {CAPABILITIES.map((item, index) => (
          <Reveal key={item.title} delay={index * 80}>
            <h3 className={`text-xl font-semibold tracking-tight ${item.tint}`}>{item.title}</h3>
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

      <dl className="mx-auto mt-[clamp(2.5rem,6vh,4rem)] grid max-w-4xl gap-x-12 gap-y-10 text-left sm:grid-cols-2">
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
        className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-[radial-gradient(55%_90%_at_50%_100%,rgb(var(--accent)/0.26),transparent_72%)]"
      />

      <Reveal className="relative">
        <Headline>Read it. Run it.</Headline>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
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
