'use client';

import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import Link from 'next/link';
import { api, type Me } from '../lib/api.ts';

/**
 * The landing page.
 *
 * This route used to bounce straight to `/login`, which meant the project
 * had no front door: anyone arriving from the repository saw a password
 * field and had to take the architecture on faith.
 *
 * Every figure below is measured, every screenshot is the real product.
 * There is no customer logo wall because Relay has no customers, and
 * inventing some would be the one thing on a page like this that is
 * actually dishonest.
 */

const REPO = 'https://github.com/r7bb/Relay';

/** Measured on an M-series laptop. See the benchmark section of the README. */
const MEASUREMENTS = [
  { value: '6.4 ms', label: 'p50 read', detail: 'list 25 issues, 64 connections' },
  { value: '4,400', label: 'requests per second', detail: 'sustained, zero errors' },
  { value: '5.8 ms', label: 'p50 fan-out', detail: 'write to all 50 subscribers' },
] as const;

/** Each entry is a decision and the reason, which is the interesting half. */
const DECISIONS = [
  {
    choice: 'Postgres LISTEN/NOTIFY instead of Redis',
    reason:
      'The event publishes inside the same transaction as the write, so an event cannot exist for a change that rolled back.',
  },
  {
    choice: 'SKIP LOCKED instead of a queue broker',
    reason:
      'Jobs are enqueued transactionally with the work that causes them. One fewer service to run, and no window where a comment exists but nobody is told.',
  },
  {
    choice: 'Keyset pagination instead of OFFSET',
    reason:
      'OFFSET re-counts on every page and shifts under concurrent inserts, so a reader silently skips one row and sees another twice.',
  },
  {
    choice: 'Opaque sessions instead of JWTs',
    reason:
      'A session can be revoked the moment a password changes. A signed token stays valid until it expires, whatever has happened since.',
  },
] as const;

/**
 * A screenshot in a frame.
 *
 * `next/image` rather than a bare `<img>` so each shot is served at the size
 * it is displayed at and the space is reserved before it loads, which is what
 * keeps the page from shifting under the reader.
 */
function Shot({
  src,
  alt,
  width,
  height,
  priority,
  className = '',
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      priority={priority}
      sizes="(max-width: 768px) 100vw, 60vw"
      className={`w-full rounded-xl border border-line ${className}`}
    />
  );
}

function SiteNav({ primaryHref, primaryLabel }: { primaryHref: string; primaryLabel: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-surface/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight text-content">
          Relay
        </Link>

        <div className="ml-auto flex items-center gap-5 text-sm">
          <a
            href={`${REPO}#architecture`}
            className="hidden text-muted transition-colors hover:text-content sm:block"
          >
            Architecture
          </a>
          <a
            href={REPO}
            className="hidden text-muted transition-colors hover:text-content sm:block"
          >
            Source
          </a>

          <Link
            href={primaryHref}
            className="rounded-md bg-accent px-3.5 py-1.5 font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {primaryLabel}
          </Link>
        </div>
      </nav>
    </header>
  );
}

function Hero({ primaryHref, primaryLabel }: { primaryHref: string; primaryLabel: string }) {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
      {/* Asymmetric split rather than a centred hero: the product is visual,
          and a screenshot earns more trust here than more prose would. */}
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.05] tracking-tighter text-content md:text-5xl lg:text-6xl">
            Works offline.
            <br />
            Syncs exactly once.
          </h1>

          <p className="mt-5 max-w-[48ch] text-base leading-relaxed text-muted">
            A collaborative workspace for issues, documents and chat. Every change queues locally
            and reconciles when you reconnect.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={primaryHref}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-all hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:translate-y-px"
            >
              {primaryLabel}
            </Link>

            <a
              href={`${REPO}#architecture`}
              className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-content transition-all hover:border-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:translate-y-px"
            >
              Read the architecture
            </a>
          </div>
        </div>

        <Shot
          src="/shots/workspace.png"
          alt="The Relay workspace: channel and team sidebar, a chat transcript, and a panel of projects."
          width={1440}
          height={900}
          priority
        />
      </div>
    </section>
  );
}

function Measurements() {
  return (
    <section className="border-y border-line bg-raised/40">
      <div className="mx-auto grid max-w-6xl gap-px px-6 py-12 sm:grid-cols-3">
        {MEASUREMENTS.map((measurement) => (
          <div key={measurement.label} className="px-2">
            {/* Mono for the figures: they are data, and a proportional font
                makes a column of numbers impossible to compare down. */}
            <p className="font-mono text-3xl font-semibold tracking-tight text-content">
              {measurement.value}
            </p>
            <p className="mt-1 text-sm font-medium text-muted">{measurement.label}</p>
            <p className="mt-0.5 text-xs text-faint">{measurement.detail}</p>
          </div>
        ))}
      </div>

      <p className="mx-auto max-w-6xl px-6 pb-8 text-xs text-faint">
        Measured with the load harness in this repository, not estimated. Single laptop, Postgres on
        the same machine.
      </p>
    </section>
  );
}

function OfflineStory() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="max-w-[20ch] text-3xl font-semibold tracking-tight text-content md:text-4xl">
        Pull the network out mid-sentence.
      </h2>

      <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-muted">
        Writes land in a durable queue in IndexedDB and the board keeps working. On reconnect the
        queue drains in order, and a server-side ledger keyed by client id means a retry after an
        ambiguous failure cannot create the same issue twice.
      </p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <figure>
          <Shot
            src="/shots/offline.png"
            alt="The board with the network disabled, showing unsynced local changes."
            width={1440}
            height={900}
          />
          <figcaption className="mt-3 text-sm text-faint">
            Offline. Three writes queued, the board still editable.
          </figcaption>
        </figure>

        <figure>
          <Shot
            src="/shots/reconnected.png"
            alt="The same board after reconnecting, with every queued change applied."
            width={1440}
            height={900}
          />
          <figcaption className="mt-3 text-sm text-faint">
            Reconnected. The queue drained, nothing duplicated.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

/**
 * A bento with exactly as many cells as there is content for: one wide cell
 * carrying a screenshot, then four narrow ones. An empty tile to even out a
 * grid is a planning mistake made visible.
 */
function Capabilities() {
  return (
    <section className="border-t border-line bg-raised/30">
      <div className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-3xl font-semibold tracking-tight text-content md:text-4xl">
          One place for the work and the talking.
        </h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <article className="overflow-hidden rounded-xl border border-line bg-surface md:col-span-2">
            <div className="p-6">
              <h3 className="text-lg font-medium text-content">Documents that merge</h3>
              <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
                Yjs CRDTs over a WebSocket gateway. Two people typing in the same paragraph converge
                without a lock and without losing a keystroke.
              </p>
            </div>

            <Shot
              src="/shots/document.png"
              alt="Two cursors editing the same document paragraph at once."
              width={1440}
              height={760}
              className="rounded-none border-0 border-t border-line"
            />
          </article>

          <article className="rounded-xl border border-line bg-surface p-6">
            <h3 className="text-lg font-medium text-content">Channels</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Workspace rooms with history, moderation, and the same permission matrix as everything
              else.
            </p>
          </article>

          <article className="rounded-xl border border-line bg-surface p-6">
            <h3 className="text-lg font-medium text-content">Meetings</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Schedule, invite, and answer. Moving the time clears everyone&rsquo;s yes, because a
              yes was for a time.
            </p>
          </article>

          <article className="rounded-xl border border-line bg-surface p-6">
            <h3 className="text-lg font-medium text-content">Four roles</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              One declarative permission matrix. Non-members get 404 rather than 403, so the API
              never confirms what it is hiding.
            </p>
          </article>

          <article className="rounded-xl border border-line bg-surface p-6">
            <h3 className="text-lg font-medium text-content">Full-text search</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Postgres tsvector columns kept current by the database itself, so the index cannot
              drift from the row.
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}

function Decisions() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-24">
      <h2 className="text-3xl font-semibold tracking-tight text-content md:text-4xl">
        The interesting half is the why.
      </h2>

      <dl className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2">
        {DECISIONS.map((decision) => (
          <div key={decision.choice}>
            <dt className="text-base font-medium text-content">{decision.choice}</dt>
            <dd className="mt-1.5 max-w-[56ch] text-sm leading-relaxed text-muted">
              {decision.reason}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Closing({ primaryHref, primaryLabel }: { primaryHref: string; primaryLabel: string }) {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight text-content md:text-4xl">
          Read the code, or try it.
        </h2>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href={primaryHref}
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-contrast transition-all hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:translate-y-px"
          >
            {primaryLabel}
          </Link>

          <a
            href={REPO}
            className="rounded-md border border-line px-5 py-2.5 text-sm font-medium text-content transition-all hover:border-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:translate-y-px"
          >
            Source on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-xs text-faint">
        <span>Relay</span>
        <a href={REPO} className="transition-colors hover:text-muted">
          GitHub
        </a>
        <Link href="/login" className="transition-colors hover:text-muted">
          Sign in
        </Link>
      </div>
    </footer>
  );
}

export default function Home() {
  // `retry: false` because a 401 here is the expected answer for a visitor,
  // not a failure worth retrying. The page renders either way.
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
  });

  const signedIn = Boolean(data?.user);
  const primaryHref = signedIn ? '/workspaces' : '/login';
  const primaryLabel = signedIn ? 'Open your workspaces' : 'Sign in';

  return (
    <div className="min-h-[100dvh] bg-surface">
      <SiteNav primaryHref={primaryHref} primaryLabel={primaryLabel} />

      <main>
        <Hero primaryHref={primaryHref} primaryLabel={primaryLabel} />
        <Measurements />
        <OfflineStory />
        <Capabilities />
        <Decisions />
        <Closing primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>

      <SiteFooter />
    </div>
  );
}
