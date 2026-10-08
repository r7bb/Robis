'use client';

import Link from 'next/link';
import { Logo } from '../../components/brand/logo.tsx';
import { Band, FILLED, Headline, OUTLINED, Shot, Subhead } from '../../features/landing/band.tsx';
import { Reveal } from '../../features/landing/motion.tsx';
import { REPO } from '../../features/landing/sections.tsx';

/**
 * How Relay works.
 *
 * The landing page used to send anyone curious about the architecture
 * straight to a README on GitHub, which is a strange thing for a product
 * to do: it hands the reader a wall of Markdown and asks them to leave.
 * This is the same material as a page, and it stops where
 * `docs/ARCHITECTURE.md` starts being more useful than prose.
 *
 * Everything claimed here is checkable in the repository, and the gaps at
 * the bottom are listed for the same reason: a page that only describes
 * what works is an advertisement, not an explanation.
 */

const WRITE_PATH = [
  {
    title: 'The client decides the id',
    body: 'Every mutation carries a key generated on the device, before anything is sent.',
  },
  {
    title: 'The queue is durable',
    body: 'It lives in IndexedDB, so closing the tab mid-edit loses nothing.',
  },
  {
    title: 'The server keeps a ledger',
    body: 'The first request for a key inserts a row and stores its response. A replay finds that row and returns the stored response instead of doing the work twice.',
  },
  {
    title: 'A retry is therefore safe',
    body: 'An offline client cannot tell a request that never arrived from one whose response was lost. Without the ledger, "create issue" retried after an ambiguous failure produces two issues.',
  },
];

/** The same request, from a member and from somebody who is not one. */
const EXCHANGES = [
  {
    who: 'A member of the workspace',
    request: 'GET /workspaces/4c84…/issues\ncookie: relay_session=…',
    status: '200 OK',
    statusTint: 'text-emerald-300',
    note: 'Membership resolved, permission checked against the matrix, rows returned.',
    frame: 'border-emerald-400/30 from-emerald-400/[0.07]',
  },
  {
    who: 'Everybody else',
    request: 'GET /workspaces/4c84…/issues\ncookie: relay_session=…',
    status: '404 Not Found',
    statusTint: 'text-rose-300',
    note: 'Not forbidden. As far as this caller is concerned, the workspace is not there.',
    frame: 'border-rose-400/30 from-rose-400/[0.07]',
  },
];

type Decision = { choice: string; instead: string; reason: string };

const DECISIONS: Decision[] = [
  {
    choice: 'Postgres LISTEN/NOTIFY',
    instead: 'Redis pub/sub',
    reason:
      'The event is published inside the same transaction as the write it describes. An event therefore cannot exist for a change that rolled back, and there is no second system to keep in step.',
  },
  {
    choice: 'A SKIP LOCKED job table',
    instead: 'a queue broker',
    reason:
      'Jobs are enqueued in the same transaction as the work that causes them, so there is no window where a comment exists but nobody has been told about it. One fewer service to run.',
  },
  {
    choice: 'Keyset pagination',
    instead: 'OFFSET',
    reason:
      'OFFSET re-counts from the start on every page, so an insert between requests shifts every later row: the reader silently skips one and sees another twice. A cursor names the last row seen.',
  },
  {
    choice: 'Opaque server-side sessions',
    instead: 'JWTs',
    reason:
      'A session can be revoked the moment a password changes. A signed token stays valid until it expires, whatever has happened in between.',
  },
  {
    choice: 'Postgres full-text search',
    instead: 'Elasticsearch',
    reason:
      'A stored generated tsvector column is recomputed by the database inside the same write, so the index cannot drift from the row it describes and there is nothing to backfill after a bug.',
  },
  {
    choice: 'Yjs CRDTs',
    instead: 'operational transform',
    reason:
      'Two people typing in one paragraph converge without a central authority deciding an order, which means a document keeps working while a client is offline.',
  },
];

/** A two-column decision list. Left-aligned: this is prose, not a headline. */
function Decisions() {
  return (
    <dl className="mx-auto mt-[clamp(2.5rem,6vh,4rem)] grid max-w-5xl gap-x-12 gap-y-10 text-left sm:grid-cols-2">
      {DECISIONS.map((decision, index) => (
        <Reveal key={decision.choice} delay={index * 60}>
          <dt className="text-lg font-semibold text-content">{decision.choice}</dt>
          <dd className="mt-2">
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-faint line-through decoration-danger-soft/70">
              {decision.instead}
            </span>
          </dd>
          <dd className="mt-2.5 text-base leading-relaxed text-muted">{decision.reason}</dd>
        </Reveal>
      ))}
    </dl>
  );
}

const SERVICES = [
  {
    accent: 'border-sky-400/50 text-sky-200',
    name: 'frontend',
    body: 'Next.js and React. Reads from IndexedDB, not the network.',
  },
  {
    accent: 'border-violet-400/50 text-violet-200',
    name: 'backend/api',
    body: 'Fastify. Every request resolves a session and checks membership.',
  },
  {
    accent: 'border-emerald-400/50 text-emerald-200',
    name: 'backend/realtime',
    body: 'A Bun WebSocket gateway: fan-out, presence, document rooms.',
  },
  {
    accent: 'border-amber-400/50 text-amber-200',
    name: 'backend/worker',
    body: 'Background jobs off the same Postgres table.',
  },
  {
    accent: 'border-rose-400/50 text-rose-200',
    name: 'shared/contracts',
    body: 'Zod schemas and the permission matrix, used by both sides.',
  },
  {
    accent: 'border-accent-soft/50 text-accent-soft',
    name: 'relay-ml',
    body: 'Duplicate detection and triage. Advisory, and optional.',
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
          <Link
            href="/"
            className="text-content transition-opacity duration-[var(--micro)] ease-[var(--ease)] hover:opacity-80"
          >
            <Logo size={32} />
          </Link>

          <div className="ml-auto flex items-center gap-5 text-sm">
            <Link
              href="/"
              className="text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content"
            >
              Overview
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-accent px-4 py-1.5 font-semibold text-accent-contrast transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <Band tone="black">
          <Reveal>
            <h1 className="mx-auto max-w-[18ch] text-balance text-[clamp(2.5rem,5.5vw,5rem)] font-semibold leading-[1.04] tracking-[-0.035em] text-content">
              How it works
            </h1>
            <Subhead>
              Four services, one database, and a queue on the client. Everything below is checkable
              in the repository.
            </Subhead>
          </Reveal>
        </Band>

        <Band tone="base">
          <Reveal>
            <Headline>A write that survives the network.</Headline>
            <Subhead>
              The board reads from IndexedDB, so it renders and accepts edits with no connection at
              all.
            </Subhead>
          </Reveal>

          <ol className="mx-auto mt-[clamp(2.5rem,6vh,4rem)] max-w-3xl text-left">
            {WRITE_PATH.map((step, index) => (
              <Reveal key={step.title} delay={index * 80}>
                <li className="relative flex gap-5 pb-9 last:pb-0">
                  {/* The rail. Drawn behind the markers and stopped on the
                      last item, so the sequence reads as finished rather
                      than trailing off. */}
                  {index < WRITE_PATH.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className="absolute left-[1.1rem] top-9 h-[calc(100%-2.25rem)] w-px bg-gradient-to-b from-accent/50 to-accent/10"
                    />
                  ) : null}

                  <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent/40 bg-surface font-mono text-sm font-semibold text-accent-soft">
                    {index + 1}
                  </span>

                  <div className="pt-1">
                    <p className="text-lg font-semibold text-content">{step.title}</p>
                    <p className="mt-1.5 text-base leading-relaxed text-muted">{step.body}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>

          <Reveal delay={160} className="mt-[clamp(2.5rem,6vh,4rem)]">
            <Shot
              src="/shots/offline.png"
              alt="The board with the network disabled, showing changes saved on the device but not yet synced."
            />
          </Reveal>
        </Band>

        <Band tone="raised">
          <Reveal>
            <Headline>Four roles, one matrix.</Headline>
            <Subhead>
              Every permission check in the API resolves against a single declarative table, so the
              rules are greppable and cannot drift between endpoints.
            </Subhead>
          </Reveal>

          <div className="mx-auto mt-[clamp(2.5rem,6vh,4rem)] grid max-w-4xl gap-5 text-left sm:grid-cols-2">
            {EXCHANGES.map((exchange, index) => (
              <Reveal key={exchange.who} delay={index * 90}>
                <div
                  className={`h-full rounded-2xl border bg-gradient-to-b to-transparent p-6 ${exchange.frame}`}
                >
                  <p className="text-sm font-medium text-content">{exchange.who}</p>

                  <pre className="mt-4 overflow-x-auto font-mono text-xs leading-relaxed text-muted">
                    <code>{exchange.request}</code>
                  </pre>

                  <p className={`mt-4 font-mono text-2xl font-semibold ${exchange.statusTint}`}>
                    {exchange.status}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{exchange.note}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={200}>
            <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-faint">
              The second response is the interesting one. A 403 would confirm the workspace exists,
              which is half of what somebody probing for it wants to know.
            </p>
          </Reveal>
        </Band>

        <Band tone="base">
          <Reveal>
            <Headline>The pieces.</Headline>
          </Reveal>

          <div className="mx-auto mt-[clamp(2.5rem,6vh,4rem)] grid max-w-5xl gap-8 text-left sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((service, index) => (
              <Reveal key={service.name} delay={index * 60}>
                <div className={`h-full rounded-2xl border-l-2 pl-5 ${service.accent}`}>
                  <p className="font-mono text-sm font-semibold">{service.name}</p>
                  <p className="mt-2 text-base leading-relaxed text-muted">{service.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Band>

        <Band tone="raised">
          <Reveal>
            <Headline>What was chosen, and why.</Headline>
            <Subhead>
              Several of these are also one fewer service to run. That constraint was real and is
              stated rather than dressed up.
            </Subhead>
          </Reveal>

          <Decisions />
        </Band>

        <Band tone="base">
          <Reveal>
            <Headline>What is missing.</Headline>
            <Subhead>
              Relay has not been deployed. These are real gaps, not an oversight, and listing them
              is the point.
            </Subhead>
          </Reveal>

          <Reveal delay={100} className="mx-auto mt-[clamp(2rem,5vh,3rem)] max-w-2xl text-left">
            <ul className="space-y-3 text-base leading-relaxed text-muted">
              <li>File uploads, which need object storage.</li>
              <li>A container build verified end to end, which needs Docker.</li>
              <li>
                A production mail driver. The API refuses to start in production without one rather
                than printing password-reset links into a log.
              </li>
              <li>
                Precision and recall for the duplicate detector. No labelled set of true duplicate
                pairs exists yet, so it is not a validated model.
              </li>
            </ul>
          </Reveal>
        </Band>

        <Band tone="black">
          <Reveal>
            <Headline>Read the code.</Headline>

            <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
              <Link href="/login" className={FILLED}>
                Get started
              </Link>
              <a href={REPO} className={OUTLINED} target="_blank" rel="noopener noreferrer">
                Source on GitHub
              </a>
            </div>
          </Reveal>
        </Band>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-xs text-faint">
          <Logo
            size={20}
            className="text-faint"
            markClassName="text-accent/70"
            wordClassName="text-sm"
          />
          <Link
            href="/"
            className="transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-muted"
          >
            Overview
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-muted"
          >
            GitHub
          </a>
          <Link
            href="/login"
            className="transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-muted"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
