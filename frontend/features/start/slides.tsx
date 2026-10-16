'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { FILLED, OUTLINED } from '../landing/band.tsx';
import { type NetworkEvent, SyncDemo } from '../landing/sync-demo.tsx';
import { ChainDemo } from './chain-demo.tsx';
import { NEEDS, SIGN_UP_HREF, type Slide } from './deck.ts';

/**
 * What each slide shows. One idea, and on the middle three, one thing to
 * touch: the real offline editors from the landing page, a real hash
 * chain, and the list of what signing up actually asks for.
 *
 * Parts rise in sequence when their slide arrives (`data-intro-rise`, timed
 * by `--rise`); with reduced motion they are simply there.
 */

type Props = {
  slide: Slide;
  active: boolean;
  /** Whether the slide has been visited, so its heavier parts may mount. */
  mounted: boolean;
  onNetwork: (event: NetworkEvent) => void;
  onActivity: () => void;
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

const TEXT_LINK =
  'underline decoration-white/30 underline-offset-4 transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content';

export function SlideBody({ slide, active, mounted, onNetwork, onActivity }: Props) {
  switch (slide.id) {
    case 'hello':
      return (
        <div className="w-full max-w-4xl">
          <Heading slide={slide} />
          <Rise order={2}>
            <p className="mt-10 text-sm text-faint">
              Use Next,{' '}
              <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-xs">
                →
              </kbd>{' '}
              or a swipe to look around. It takes about a minute.
            </p>
          </Rise>
        </div>
      );

    case 'offline':
      return (
        <Split slide={slide}>
          {mounted ? (
            <SyncDemo onNetwork={onNetwork} onActivity={onActivity} />
          ) : (
            <div className="h-[22rem] rounded-2xl border border-white/10 bg-white/[0.02]" />
          )}
        </Split>
      );

    case 'record':
      return (
        <Split slide={slide}>
          <ChainDemo active={active} />
        </Split>
      );

    case 'needs':
      return (
        <div className="w-full">
          <Heading slide={slide} />
          <ul className="mt-10 grid gap-3 sm:grid-cols-2">
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
        </div>
      );

    case 'start':
      return (
        <div className="w-full max-w-3xl">
          <Heading slide={slide} />
          <Rise order={2}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={SIGN_UP_HREF} className={FILLED} data-intro-primary="">
                Create account
              </Link>
              <Link href="/login" className={OUTLINED}>
                Sign in
              </Link>
            </div>
          </Rise>
          <Rise order={3}>
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
