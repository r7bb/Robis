'use client';

import Image from 'next/image';
import Link from 'next/link';
import { BANDS, Band, FILLED, Headline, OUTLINED, Shot, Subhead } from './band.tsx';
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

/** Three measured figures, short enough to read in a glance. */
const HERO_PROOF = [
  { value: 6.4, decimals: 1, suffix: 'ms', label: 'to read a board' },
  { value: 4400, decimals: 0, suffix: '', label: 'requests a second' },
  { value: 5.8, decimals: 1, suffix: 'ms', label: 'to reach everyone' },
] as const;

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
            <Link href="/how-it-works" className={OUTLINED}>
              How it works
            </Link>
          </div>
        </Reveal>

        {/*
         * The board, not the chat. The chat screenshot is mostly an empty
         * message pane, which at hero size reads as an unfinished product;
         * the board is dense and colourful and shows the work.
         */}
        {/*
         * The first screen has to do the selling. Headline, subhead and
         * buttons ended at 394px of a 758px viewport, and the rest of the
         * fold was the top 44% of a screenshot, which reads as a cropped
         * image rather than a deliberate peek. These are the most
         * convincing things Relay has and they are measured, so they go
         * above the fold and the screenshot starts under it on purpose.
         */}
        <Reveal delay={200}>
          <dl className="mx-auto mt-10 flex max-w-2xl flex-wrap items-baseline justify-center gap-x-10 gap-y-3">
            {HERO_PROOF.map((item) => (
              <div key={item.label} className="flex items-baseline gap-2">
                <dt className="sr-only">{item.label}</dt>
                <dd className="font-mono text-lg font-semibold text-amber-200">
                  <Counter value={item.value} decimals={item.decimals} suffix={item.suffix} />
                </dd>
                <dd className="text-sm text-muted">{item.label}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-faint">Measured by the benchmark in this repository.</p>
        </Reveal>

        <Reveal delay={260} className="mt-[clamp(2.5rem,6vh,4.5rem)]">
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
          {/*
            `top-16` and a height reduced by the same amount, because the
            nav is sticky and 4rem tall. Pinning at `top-0` against a full
            `100svh` centres the content against the whole viewport while
            the top 64px of it is covered, so everything sits exactly one
            nav-height too high -- measured at 4px above the nav's bottom
            edge and 61px of slack below.
          */}
          <div className="sticky top-16 flex h-[calc(100svh-4rem)] flex-col items-center justify-center gap-[clamp(1rem,3vh,2.5rem)] py-[clamp(2rem,6vh,4rem)]">
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
          <a href={REPO} className={OUTLINED} target="_blank" rel="noopener noreferrer">
            Source on GitHub
          </a>
        </div>
      </Reveal>
    </Band>
  );
}
