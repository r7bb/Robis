'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Counter, Reveal } from './motion.tsx';
import { useActiveStep } from './use-scroll.ts';

/**
 * The landing page's sections.
 *
 * Colour here is doing a job rather than decorating. Each section owns one
 * hue and keeps it, so scrolling reads as moving between distinct places
 * instead of down one long grey column, and the hue matches what the
 * section is about: green for "it still works", amber for "measured",
 * violet for the reasoning.
 *
 * Every accent used below clears 7:1 against the page background, which is
 * what lets them be this saturated without becoming unreadable.
 */

export const REPO = 'https://github.com/r7bb/Relay';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-full bg-accent px-6 py-3 text-sm font-semibold text-accent-contrast shadow-lg shadow-accent/25 transition-all hover:bg-accent-hover hover:shadow-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:translate-y-px';

const GHOST_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-line bg-raised/60 px-6 py-3 text-sm font-semibold text-content backdrop-blur transition-all hover:border-accent-soft hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:translate-y-px';

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
      sizes="(max-width: 1024px) 100vw, 55vw"
      className={`w-full rounded-xl border border-line shadow-2xl shadow-black/50 ${className}`}
    />
  );
}

export function Hero({ href, label }: { href: string; label: string }) {
  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-20 md:pt-28">
      {/*
       * A single soft wash behind the hero rather than a mesh of blobs.
       * `pointer-events-none` because it covers the header area and would
       * otherwise swallow clicks on the nav.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[32rem] bg-[radial-gradient(60%_60%_at_50%_0%,rgb(var(--accent)/0.38),transparent_72%)]"
      />

      <div className="relative mx-auto max-w-6xl">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
            Works with the network off
          </p>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="mt-6 max-w-[16ch] text-5xl font-semibold leading-[1.02] tracking-tighter text-content md:text-7xl">
            The workspace that{' '}
            <span className="bg-gradient-to-br from-sky-300 via-accent-soft to-violet-300 bg-clip-text text-transparent">
              never stops
            </span>
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-muted">
            Issues, documents, chat and meetings. Every change queues on your device and reconciles
            when you reconnect, exactly once.
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href={href} className={PRIMARY_BUTTON}>
              {label}
            </Link>
            <a href={`${REPO}#architecture`} className={GHOST_BUTTON}>
              Read the architecture
            </a>
          </div>
        </Reveal>

        <Reveal delay={320} className="mt-16">
          <Shot
            src="/shots/workspace.png"
            alt="The Relay workspace: channels and team on the left, a conversation in the middle, projects on the right."
            priority
          />
        </Reveal>
      </div>
    </section>
  );
}

/** The three states of a write, told by scrolling through them. */
const OFFLINE_STEPS = [
  {
    kicker: 'Online',
    title: 'You file an issue.',
    body: 'It reaches the server and fans out to everyone watching the board in about six milliseconds.',
    shot: '/shots/workspace.png',
    alt: 'The workspace with a live connection.',
    tint: 'text-sky-300',
    ring: 'ring-sky-400/30',
  },
  {
    kicker: 'Offline',
    title: 'The network drops.',
    body: 'Writes land in a durable queue in IndexedDB. The board stays editable, and nothing is lost on a reload.',
    shot: '/shots/offline.png',
    alt: 'The board with the network disabled, showing unsynced changes.',
    tint: 'text-amber-300',
    ring: 'ring-amber-400/30',
  },
  {
    kicker: 'Reconnected',
    title: 'The queue drains, in order.',
    body: 'A server-side ledger keyed by a client-generated id means a retry after an ambiguous failure cannot create the same issue twice.',
    shot: '/shots/reconnected.png',
    alt: 'The same board after reconnecting, every queued change applied.',
    tint: 'text-emerald-300',
    ring: 'ring-emerald-400/30',
  },
] as const;

/**
 * The scroll-told sequence.
 *
 * A sticky stage with one spacer per step scrolling past it. This is the
 * one place on the page where motion does real work: the reader is walked
 * through three states of the same board in order, and the order is the
 * explanation.
 */
export function OfflineStory() {
  const [refs, active] = useActiveStep(OFFLINE_STEPS.length);
  const step = OFFLINE_STEPS[active] ?? OFFLINE_STEPS[0];

  return (
    <section className="relative border-y border-line bg-[radial-gradient(90%_50%_at_10%_20%,rgb(56_189_248/0.10),transparent_60%),radial-gradient(80%_50%_at_90%_80%,rgb(52_211_153/0.10),transparent_60%)]">
      <div className="mx-auto max-w-6xl px-6">
        <div className="lg:grid lg:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] lg:gap-12">
          {/* `h-dvh`, not `h-screen`: on mobile Safari `100vh` includes the
              browser chrome and the stage would overflow it. */}
          <div className="sticky top-0 flex h-dvh flex-col justify-center py-16">
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${step.tint}`}>
              {step.kicker}
            </p>

            <h2 className="mt-4 max-w-[18ch] text-4xl font-semibold leading-tight tracking-tight text-content md:text-5xl">
              {step.title}
            </h2>

            <p className="mt-5 max-w-[46ch] text-base leading-relaxed text-muted">{step.body}</p>

            {/* Position in the sequence. Hidden from screen readers: all
                three steps are in the DOM below, so this would announce a
                position in something already read. */}
            <div className="mt-8 flex gap-2" aria-hidden="true">
              {OFFLINE_STEPS.map((item, index) => (
                <span
                  key={item.kicker}
                  className={`h-1 rounded-full transition-all duration-500 ${
                    index === active ? 'w-10 bg-accent-soft' : 'w-4 bg-line'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-0 flex h-dvh items-center">
              <div className="relative w-full">
                {OFFLINE_STEPS.map((item, index) => (
                  <div
                    key={item.kicker}
                    data-frame=""
                    data-active={index === active}
                    // Stacked, so a cross-fade is two opacities rather than
                    // a layout change. The first is in flow and holds the
                    // height; the rest are positioned over it.
                    className={index === 0 ? 'relative' : 'absolute inset-0'}
                  >
                    <Shot src={item.shot} alt={item.alt} className={`ring-4 ${item.ring}`} />
                  </div>
                ))}
              </div>
            </div>

            {/* The scroll distance: one viewport per step, minus the one the
                sticky stage already occupies. */}
            {OFFLINE_STEPS.map((item, index) => (
              <div
                key={item.kicker}
                ref={refs[index]}
                className={index === 0 ? 'h-0' : 'h-dvh'}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>

        {/* Below `lg` the sticky stage has no room, so the steps stack and
            read as three ordinary blocks. */}
        <div className="space-y-12 pb-20 lg:hidden">
          {OFFLINE_STEPS.map((item) => (
            <Reveal key={item.kicker}>
              <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${item.tint}`}>
                {item.kicker}
              </p>
              <h3 className="mt-2 text-2xl font-semibold tracking-tight text-content">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              <div className="mt-4">
                <Shot src={item.shot} alt={item.alt} className={`ring-4 ${item.ring}`} />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const MEASUREMENTS = [
  { value: 6.4, decimals: 1, suffix: ' ms', label: 'p50 read', detail: 'list 25 issues' },
  { value: 4400, decimals: 0, suffix: '', label: 'requests / second', detail: 'zero errors' },
  { value: 5.8, decimals: 1, suffix: ' ms', label: 'p50 fan-out', detail: 'to all 50 subscribers' },
] as const;

export function Measurements() {
  return (
    <section className="bg-[radial-gradient(70%_60%_at_50%_0%,rgb(251_191_36/0.10),transparent_65%)] px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <h2 className="max-w-[18ch] text-4xl font-semibold tracking-tight text-content md:text-5xl">
            Numbers from a <span className="text-amber-300">real benchmark</span>.
          </h2>
          <p className="mt-4 max-w-[52ch] text-base text-muted">
            Produced by the load harness in this repository, not estimated. One laptop, Postgres on
            the same machine.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {MEASUREMENTS.map((item, index) => (
            <Reveal key={item.label} delay={index * 100}>
              <div className="h-full rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-500/[0.16] to-transparent p-6">
                <p className="font-mono text-4xl font-semibold tracking-tight text-amber-200">
                  <Counter value={item.value} decimals={item.decimals} suffix={item.suffix} />
                </p>
                <p className="mt-2 text-sm font-medium text-content">{item.label}</p>
                <p className="mt-0.5 text-xs text-faint">{item.detail}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  {
    title: 'Documents that merge',
    body: 'Yjs CRDTs over a WebSocket gateway. Two people in the same paragraph converge without a lock.',
    accent: 'border-violet-400/40 from-violet-500/[0.16]',
    heading: 'text-violet-200',
  },
  {
    title: 'Channels',
    body: 'Workspace rooms with history and moderation, under the same permission matrix as everything else.',
    accent: 'border-sky-400/40 from-sky-500/[0.16]',
    heading: 'text-sky-200',
  },
  {
    title: 'Meetings',
    body: 'Schedule, invite, answer. Moving the time clears everyone else’s yes, because a yes was for a time.',
    accent: 'border-emerald-400/40 from-emerald-500/[0.16]',
    heading: 'text-emerald-200',
  },
  {
    title: 'Four roles',
    body: 'One declarative matrix. Non-members get 404, not 403, so the API never confirms what it hides.',
    accent: 'border-rose-400/40 from-rose-500/[0.16]',
    heading: 'text-rose-200',
  },
  {
    title: 'Full-text search',
    body: 'Postgres tsvector columns the database keeps current, so the index cannot drift from the row.',
    accent: 'border-amber-400/40 from-amber-500/[0.16]',
    heading: 'text-amber-200',
  },
] as const;

export function Capabilities() {
  const [lead, ...rest] = CAPABILITIES;

  return (
    <section className="border-t border-line bg-[radial-gradient(75%_60%_at_80%_10%,rgb(167_139_250/0.12),transparent_60%)] px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <h2 className="max-w-[20ch] text-4xl font-semibold tracking-tight text-content md:text-5xl">
            One place for the work and the <span className="text-sky-300">talking</span>.
          </h2>
        </Reveal>

        {/* Five cells for five things. An empty tile to even out a grid is a
            planning mistake made visible. */}
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          <Reveal className="md:col-span-2">
            <article
              className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-gradient-to-b to-transparent ${lead!.accent}`}
            >
              <div className="p-7">
                <h3 className={`text-xl font-semibold ${lead!.heading}`}>{lead!.title}</h3>
                <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">{lead!.body}</p>
              </div>

              <Image
                src="/shots/document.png"
                alt="Two cursors editing the same paragraph at once."
                width={1440}
                height={760}
                sizes="(max-width: 768px) 100vw, 60vw"
                className="mt-auto w-full border-t border-line"
              />
            </article>
          </Reveal>

          {rest.map((item, index) => (
            <Reveal key={item.title} delay={(index + 1) * 80}>
              <article
                className={`h-full rounded-2xl border bg-gradient-to-b to-transparent p-7 ${item.accent}`}
              >
                <h3 className={`text-lg font-semibold ${item.heading}`}>{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const DECISIONS = [
  {
    choice: 'Postgres LISTEN/NOTIFY',
    instead: 'Redis pub/sub',
    reason:
      'The event publishes in the same transaction as the write, so an event cannot exist for a change that rolled back.',
  },
  {
    choice: 'SKIP LOCKED job queue',
    instead: 'a queue broker',
    reason:
      'Jobs enqueue transactionally with the work that causes them. One fewer service, and no window where a comment exists but nobody is told.',
  },
  {
    choice: 'Keyset pagination',
    instead: 'OFFSET',
    reason:
      'OFFSET re-counts every page and shifts under concurrent inserts, so a reader silently skips one row and sees another twice.',
  },
  {
    choice: 'Opaque sessions',
    instead: 'JWTs',
    reason:
      'A session dies the moment a password changes. A signed token stays valid until it expires, whatever has happened since.',
  },
] as const;

export function Decisions() {
  return (
    <section className="border-t border-line bg-[radial-gradient(70%_60%_at_20%_0%,rgb(99_102_241/0.12),transparent_65%)] px-6 py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal>
          <h2 className="max-w-[20ch] text-4xl font-semibold tracking-tight text-content md:text-5xl">
            The interesting half is the <span className="text-violet-300">why</span>.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-x-10 gap-y-10 md:grid-cols-2">
          {DECISIONS.map((decision, index) => (
            <Reveal key={decision.choice} delay={index * 70}>
              <div className="border-l-2 border-accent/40 pl-5">
                <p className="text-base font-semibold text-content">{decision.choice}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-faint">
                  instead of {decision.instead}
                </p>
                <p className="mt-2.5 max-w-[54ch] text-sm leading-relaxed text-muted">
                  {decision.reason}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Closing({ href, label }: { href: string; label: string }) {
  return (
    <section className="relative overflow-hidden border-t border-line px-6 py-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-[radial-gradient(55%_90%_at_50%_100%,rgb(var(--accent)/0.3),transparent_70%)]"
      />

      <Reveal className="relative mx-auto max-w-6xl text-center">
        <h2 className="mx-auto max-w-[20ch] text-4xl font-semibold tracking-tight text-content md:text-5xl">
          Read the code, or try it.
        </h2>

        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Link href={href} className={PRIMARY_BUTTON}>
            {label}
          </Link>
          <a href={REPO} className={GHOST_BUTTON}>
            Source on GitHub
          </a>
        </div>
      </Reveal>
    </section>
  );
}
