'use client';

import { Chapter, ChapterTitle } from './chapter.tsx';
import { Reveal } from './motion.tsx';

/**
 * The questions somebody actually has after reading the page.
 *
 * Built on `<details>` and `<summary>` rather than buttons and state.
 * The native element already handles the keyboard, exposes the right role
 * to a screen reader, and lets the browser find collapsed text with
 * ctrl-F. A hand-rolled accordion has to reimplement all three and
 * usually reimplements the first two badly.
 *
 * The answers say no where the answer is no. A FAQ that only asks
 * flattering questions is a brochure, and the first question here is the
 * one a recruiter or an engineer will actually have.
 */

type Question = { q: string; a: string };

const QUESTIONS: Question[] = [
  {
    q: 'Can I use this for real work?',
    a: 'Not yet. Robis runs locally and is covered by over 400 tests, but it has never been deployed: there is no hosted instance, no file uploads and no production mail driver. It is a portfolio project built to be read as much as run.',
  },
  {
    q: 'Does it genuinely work offline, or is that a cache?',
    a: 'Genuinely. The board reads from IndexedDB rather than the network, so it renders and accepts edits with no connection. Writes go into a durable queue and drain in order on reconnect, and a server-side ledger keyed by a client-generated id means a retry after an ambiguous failure cannot create the same issue twice.',
  },
  {
    q: 'What happens if two people edit the same paragraph?',
    a: 'Both edits survive. Documents are Yjs CRDTs, so convergence is a property of the data structure rather than of who reached the server first. Nobody takes a lock and nobody loses a keystroke.',
  },
  {
    q: 'Why no Redis, and no queue broker?',
    a: 'Because Postgres already does both jobs transactionally. LISTEN/NOTIFY publishes an event in the same transaction as the write, so an event cannot describe a change that rolled back. A SKIP LOCKED table enqueues a job in the same transaction as the work that causes it. Adding Redis would mean two systems that can disagree.',
  },
  {
    q: 'Is my data secure?',
    a: 'That is not a claim worth making about an undeployed project, so here is what the code does instead: passwords are hashed with Argon2id, sessions are opaque and server-side so changing a password kills them immediately, every endpoint checks membership against one permission matrix, and a non-member gets 404 rather than 403 so the API never confirms what it is hiding. None of that has been independently audited.',
  },
  {
    q: 'What is the machine learning for?',
    a: 'Suggesting possible duplicates as you type an issue title, and proposing a priority. Both are advisory and nothing acts on them. Below forty triaged issues the model refuses to predict rather than returning a confident-looking guess, and the duplicate detector has no precision figure yet because no labelled set of true duplicate pairs exists.',
  },
  {
    q: 'Can I run it myself?',
    a: 'Yes. Clone it, then bun install and bun run db:start. Postgres comes from npm rather than Docker, so it works on a machine with no container runtime. The README has the four commands.',
  },
];

export function Faq() {
  return (
    <Chapter>
      <div className="grid gap-[clamp(2.5rem,5vw,5rem)] lg:grid-cols-12">
        {/* The heading stays in view while the questions scroll past it. */}
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <ChapterTitle aside="Including the ones with an awkward answer.">
              Questions.
            </ChapterTitle>
          </div>
        </div>

        <div className="border-t border-white/10 lg:col-span-8">
          {QUESTIONS.map((item, index) => (
            <Reveal key={item.q} delay={index * 50}>
              <details className="group border-b border-white/10">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-left text-lg font-medium text-content transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft">
                  {item.q}

                  {/*
                  A plus that becomes a minus. Two lines rather than a
                  rotating glyph, so it reads the same in any font and at
                  any size. Hidden from screen readers because `details`
                  already announces whether it is expanded.
                */}
                  <span
                    aria-hidden="true"
                    className="relative h-4 w-4 shrink-0 text-faint transition-colors duration-[var(--micro)] ease-[var(--ease)] group-hover:text-accent-soft"
                  >
                    <span className="absolute left-0 top-1/2 h-px w-4 -translate-y-1/2 bg-current" />
                    <span className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-current transition-transform duration-[var(--quick)] ease-[var(--ease)] group-open:scale-y-0" />
                  </span>
                </summary>

                <p className="max-w-[68ch] pb-6 pr-10 text-base leading-relaxed text-muted">
                  {item.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </Chapter>
  );
}
