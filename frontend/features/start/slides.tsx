'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { FILLED, OUTLINED } from '../landing/band.tsx';
import { NEEDS, QUOTES, type Quote, SIGN_UP_HREF, type Slide } from './deck.ts';
import { SortDesk } from './sort-desk.tsx';
import { Tunnel } from './tunnel.tsx';

/**
 * What each slide shows. Not the landing page again: three quotes from
 * people who thought hard about plans and teams, each answered in a line,
 * and between them two small things to play with, a desk to sort and a
 * tunnel to work through.
 *
 * Parts rise in sequence when their slide arrives (`data-intro-rise`, timed
 * by `--rise`); with reduced motion they are simply there.
 */

type Props = {
  slide: Slide;
  active: boolean;
  /** The tunnel's signal, passed up so the background can dim with it. */
  onSignal: (online: boolean) => void;
};

function Rise({
  order,
  children,
  className = '',
}: {
  order: number;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-intro-rise="" style={{ '--rise': order } as CSSProperties} className={className}>
      {children}
    </div>
  );
}

function Heading({ slide }: { slide: Slide }) {
  return (
    <>
      <Rise order={0}>
        <h2 className="max-w-[16ch] text-balance text-[clamp(2.25rem,4.6vw,4.5rem)] font-semibold leading-[1.03] tracking-[-0.04em] text-content">
          {slide.title}
        </h2>
      </Rise>
      <Rise order={1}>
        <p className="mt-5 max-w-[44ch] text-[clamp(1.02rem,1.35vw,1.2rem)] leading-relaxed text-muted">
          {slide.body}
        </p>
      </Rise>
    </>
  );
}

/** Text on the left, the thing to touch on the right; stacked on a phone. */
function Split({ slide, children }: { slide: Slide; children: ReactNode }) {
  return (
    <div className="grid w-full gap-[clamp(2rem,5vw,4.5rem)] lg:grid-cols-12 lg:items-center">
      <div className="lg:col-span-5">
        <Heading slide={slide} />
      </div>
      <Rise order={2} className="lg:col-span-7">
        {children}
      </Rise>
    </div>
  );
}

/** Who said it and where, so the quote can be checked. */
function Attribution({ quote }: { quote: Quote }) {
  return (
    <figcaption className="text-sm text-muted">
      <span className="text-content">{quote.who}</span>
      <span aria-hidden="true" className="mx-2 text-faint">
        ·
      </span>
      <cite className="not-italic text-faint">{quote.source}</cite>
    </figcaption>
  );
}

/**
 * A quote as the picture, and the slide's own line beneath it, set off to
 * the right as the reply.
 */
function QuoteSlide({ slide, quote }: { slide: Slide; quote: Quote }) {
  return (
    <div className="w-full">
      <Rise order={0}>
        <figure>
          {/* The width in ch of the quote's own size, not the figure's. */}
          <blockquote className="relative max-w-[20ch] text-balance text-[clamp(2rem,4.4vw,4.25rem)] font-medium leading-[1.08] tracking-[-0.035em] text-content">
            {/* Hung in the margin where there is one; above the words on a
                phone, where the margin is only the page's gutter. */}
            <span
              aria-hidden="true"
              className="block h-[0.5em] select-none text-accent-soft/60 lg:absolute lg:-left-[0.55em] lg:-top-[0.08em] lg:h-auto"
            >
              “
            </span>
            {quote.text}
          </blockquote>
          <div className="mt-6">
            <Attribution quote={quote} />
          </div>
        </figure>
      </Rise>
      <Rise order={1} className="mt-[clamp(2.5rem,7vh,5rem)] lg:ml-auto lg:max-w-md">
        <div className="border-t border-white/15 pt-5">
          <h2 className="text-balance text-xl font-semibold tracking-[-0.02em] text-content">
            {slide.title}
          </h2>
          <p className="mt-2 leading-relaxed text-muted">{slide.body}</p>
        </div>
      </Rise>
    </div>
  );
}

const TEXT_LINK =
  'underline decoration-white/30 underline-offset-4 transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content';

const KEY = 'rounded border border-white/15 px-1.5 py-0.5 font-mono text-xs';

export function SlideBody({ slide, active, onSignal }: Props) {
  switch (slide.id) {
    case 'hello':
      return (
        <div className="w-full max-w-4xl">
          <Heading slide={slide} />
          <Rise order={2}>
            <figure className="mt-12 max-w-[52ch] border-l border-accent-soft/40 pl-5">
              <blockquote className="text-pretty leading-relaxed text-content/90">
                {QUOTES.hopper.text}
              </blockquote>
              <div className="mt-2">
                <Attribution quote={QUOTES.hopper} />
              </div>
            </figure>
          </Rise>
          <Rise order={3}>
            <p className="mt-10 text-sm text-faint">
              Swipe with two fingers, press <kbd className={KEY}>→</kbd>, or use Next. It takes
              about a minute.
            </p>
          </Rise>
        </div>
      );

    case 'plans':
      return <QuoteSlide slide={slide} quote={QUOTES.plans} />;

    case 'desk':
      return (
        <Split slide={slide}>
          <SortDesk />
        </Split>
      );

    case 'team':
      return <QuoteSlide slide={slide} quote={QUOTES.brooks} />;

    case 'tunnel':
      return (
        <Split slide={slide}>
          <Tunnel active={active} onSignal={onSignal} />
        </Split>
      );

    case 'start':
      return (
        <div className="w-full max-w-4xl">
          <Heading slide={slide} />
          <ul className="mt-9 grid gap-3 sm:grid-cols-3">
            {NEEDS.map((need, i) => (
              <li key={need.what}>
                <Rise
                  order={2 + i}
                  className="h-full rounded-2xl border border-white/10 bg-[#0c0e13]/85 p-5"
                >
                  <p className="font-medium text-content">{need.what}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{need.why}</p>
                </Rise>
              </li>
            ))}
          </ul>
          <Rise order={5}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={SIGN_UP_HREF} className={FILLED} data-intro-primary="">
                Create account
              </Link>
              <Link href="/login" className={OUTLINED}>
                Sign in
              </Link>
            </div>
          </Rise>
          <Rise order={6}>
            <p className="mt-6 text-sm text-faint">
              Signing up asks you to confirm your age, and is covered by the{' '}
              <Link href="/terms" className={TEXT_LINK}>
                terms
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className={TEXT_LINK}>
                privacy
              </Link>{' '}
              pages.
            </p>
          </Rise>
        </div>
      );
  }
}
