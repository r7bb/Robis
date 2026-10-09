'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { FILLED, OUTLINED } from './band.tsx';
import { Field } from './field.tsx';
import { Counter, Reveal } from './motion.tsx';
import { SyncDemo } from './sync-demo.tsx';
import { Wordmark } from './wordmark.tsx';

/**
 * The first screen.
 *
 * Two references, combined. From an architecture studio's site: the name set
 * edge to edge, and a strict column grid whose rules mark real column edges.
 * From a chip company's site: something alive behind it. Here the live part
 * is not ornament. The point field reacts to the demo, and the demo is the
 * product's one promise, made into something a visitor can try to break.
 *
 * Left-aligned rather than centred: the statement and the demo are read
 * side by side, the way a person compares a claim with its evidence.
 */

/** Three measured figures, short enough to read in a glance. */
const HERO_PROOF = [
  { value: 6.4, decimals: 1, suffix: 'ms', label: 'to read a board' },
  { value: 4400, decimals: 0, suffix: '', label: 'requests a second' },
  { value: 5.8, decimals: 1, suffix: 'ms', label: 'to reach everyone' },
] as const;

export function Hero({ href, label }: { href: string; label: string }) {
  const [offline, setOffline] = useState(false);
  const [pulse, setPulse] = useState(0);

  return (
    <section className="relative isolate overflow-hidden bg-[#08090c]">
      {/* The field covers the first screen only, so the plane sits behind
          the grid and the demo rather than far down behind the screenshot. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-[min(100dvh,62rem)]">
        <Field offline={offline} pulse={pulse} />
        {/* Darkens the top for the wordmark and fades only the last strip
            into the band, so the near edge of the plane stays visible. */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(8_9_12/0.55),transparent_32%,transparent_82%,#08090c)]" />
      </div>

      <div className="mx-auto w-full max-w-[1400px] px-[clamp(1rem,3vw,2.5rem)]">
        <Reveal className="pt-[clamp(0.25rem,1.5vw,1.25rem)]">
          <Wordmark />
        </Reveal>

        <div className="grid border-t border-white/10 lg:grid-cols-12">
          <div className="py-[clamp(2rem,5vh,3.5rem)] lg:col-span-5 lg:border-r lg:border-white/10 lg:pr-10">
            <Reveal delay={60}>
              {/*
               * The proposition, not the product name. The name is already
               * the biggest thing on the screen; this line says what it is.
               */}
              <h1 className="max-w-[12ch] text-balance text-[clamp(2.5rem,4.4vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.04em] text-content">
                Never lose a change.
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="mt-5 max-w-[38ch] text-[clamp(1.05rem,1.4vw,1.25rem)] leading-relaxed text-muted">
                Issues, documents, chat and meetings that keep working when the network does not.
              </p>
            </Reveal>

            <Reveal delay={180}>
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

          <div className="border-t border-white/10 py-[clamp(2rem,5vh,3.5rem)] lg:col-span-7 lg:border-t-0 lg:pl-10">
            <Reveal delay={240}>
              <SyncDemo
                onNetwork={({ online, merged }) => {
                  setOffline(!online);
                  if (online && merged > 0) setPulse((count) => count + 1);
                }}
              />
            </Reveal>
          </div>
        </div>

        <Reveal delay={300}>
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
            <p className="mt-3 text-xs text-faint">Measured by the benchmark in this repository.</p>
          </div>
        </Reveal>

        {/*
         * The real app, under the fold on purpose. The first screen is the
         * claim and the demo; this is the proof that it is a product rather
         * than a toy. Cropped to 2:1 from the top, because the lower third
         * of the board capture is empty column space.
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
    </section>
  );
}
