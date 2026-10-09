'use client';

import Image from 'next/image';
import Link from 'next/link';
import { type RefObject, useCallback, useRef, useState } from 'react';
import { FILLED, OUTLINED } from './band.tsx';
import { Field } from './field.tsx';
import { type FieldMode, modeForLetter } from './field-modes.ts';
import { Counter, Reveal } from './motion.tsx';
import { NameStage } from './name-stage.tsx';
import { SyncDemo } from './sync-demo.tsx';

/**
 * The opening of the landing page, in two acts over one live background.
 *
 * First the name, alone with the field: no header, no buttons, nothing to
 * read but five letters. Scrolling pins the name and walks through what each
 * letter stands for (`NameStage`). Then the claim and the evidence for it:
 * "Never lose a change." beside a demo that lets you cut the network and
 * try to lose something.
 *
 * The field is one sticky layer under both acts, so it never stops. It takes
 * each letter's formation while the name is pinned, then mirrors the demo:
 * grey when the network is cut, a swell on each keystroke, a ring on merge.
 */

/** Three measured figures, short enough to read in a glance. */
const HERO_PROOF = [
  { value: 6.4, decimals: 1, suffix: 'ms', label: 'to read a board' },
  { value: 4400, decimals: 0, suffix: '', label: 'requests a second' },
  { value: 5.8, decimals: 1, suffix: 'ms', label: 'to reach everyone' },
] as const;

export function Hero({
  href,
  label,
  sentinel,
}: {
  href: string;
  label: string;
  /** Placed after the name; the page shows its header once this scrolls away. */
  sentinel: RefObject<HTMLDivElement | null>;
}) {
  const [letter, setLetter] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [pulse, setPulse] = useState(0);
  // Keystrokes go straight to the field through a ref; a state update per
  // keystroke would re-render the whole hero every few dozen milliseconds.
  const lastKeystroke = useRef(Number.NEGATIVE_INFINITY);

  const onLetter = useCallback((next: string | null) => setLetter(next), []);

  // The demo's network switch wins: cutting it greys the field wherever the
  // page is. Otherwise the field takes the lit letter's formation.
  const mode: FieldMode = offline ? 'offline' : modeForLetter(letter);

  return (
    // `overflow-x-clip`, not `overflow-hidden`: hidden would make this the
    // scroll container for its sticky children and stop them pinning.
    <section className="relative isolate overflow-x-clip bg-[#08090c]">
      <div aria-hidden="true" className="sticky top-0 -z-10 h-[100svh]">
        <Field mode={mode} pulse={pulse} activityAt={lastKeystroke} />
        {/* Darkens the top behind the name and fades the bottom edge into
            the band, so the near edge of the plane stays visible. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(8_9_12/0.5),transparent_35%,transparent_85%,#08090c)]" />
      </div>

      <div className="-mt-[100svh]">
        <NameStage onLetter={onLetter} />
        <div ref={sentinel} aria-hidden="true" className="h-px" />

        <div className="mx-auto w-full max-w-[1400px] px-[clamp(1rem,3vw,2.5rem)]">
          <div className="grid border-t border-white/10 lg:grid-cols-12 lg:gap-x-12">
            <div className="py-[clamp(3rem,8vh,6rem)] lg:col-span-5">
              <Reveal>
                {/*
                 * The proposition, after the name has been explained. The
                 * page's only h1: the letters above are buttons, and the
                 * name is in the header from here on.
                 */}
                <h1 className="max-w-[12ch] text-balance text-[clamp(2.5rem,4.4vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-content">
                  Never lose a change.
                </h1>
              </Reveal>

              <Reveal delay={80}>
                <p className="mt-5 max-w-[38ch] text-[clamp(1.05rem,1.4vw,1.25rem)] leading-relaxed text-muted">
                  Issues, documents, chat and meetings that keep working when the network does not.
                </p>
              </Reveal>

              <Reveal delay={160}>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Link href={href} className={FILLED}>
                    {label}
                  </Link>
                  <Link href="/how-it-works" className={OUTLINED}>
                    How it works
                  </Link>
                </div>
              </Reveal>
            </div>

            <div className="border-t border-white/10 py-[clamp(3rem,8vh,6rem)] lg:col-span-7 lg:border-t-0">
              <Reveal delay={200}>
                <SyncDemo
                  onNetwork={({ online, merged }) => {
                    setOffline(!online);
                    if (online && merged > 0) setPulse((count) => count + 1);
                  }}
                  onActivity={() => {
                    lastKeystroke.current = performance.now();
                  }}
                />
              </Reveal>
            </div>
          </div>

          <Reveal>
            <div className="border-t border-white/10 py-6">
              <dl className="grid gap-x-10 gap-y-3 sm:grid-cols-3">
                {HERO_PROOF.map((item) => (
                  <div key={item.label} className="flex items-baseline gap-2">
                    <dt className="sr-only">{item.label}</dt>
                    <dd className="font-mono text-lg font-semibold tabular-nums text-amber-200">
                      <Counter value={item.value} decimals={item.decimals} suffix={item.suffix} />
                    </dd>
                    <dd className="text-sm text-muted">{item.label}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-faint">
                Measured by the benchmark in this repository.
              </p>
            </div>
          </Reveal>

          {/*
           * The real app, last. The name and the demo are the claim; this is
           * the proof that it is a product rather than a toy. Cropped to 2:1
           * from the top, because the lower third of the board capture is
           * empty column space.
           */}
          <Reveal className="pb-[clamp(4rem,9vh,8rem)]">
            <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl border border-white/10 shadow-2xl shadow-black/60">
              <Image
                src="/shots/board.png"
                alt="The Robis issue board, with a column per status and coloured priority badges."
                width={1440}
                height={900}
                sizes="(max-width: 1400px) 100vw, 1400px"
                className="absolute inset-0 h-full w-full object-cover object-top"
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
