'use client';

import Image from 'next/image';
import type { CSSProperties } from 'react';
import { CHAPTER_BG, CHAPTER_FRAME, ChapterTitle } from './chapter.tsx';
import { Reveal } from './motion.tsx';
import { useActiveStep } from './use-scroll.ts';

/**
 * Three states of one board, told by scrolling.
 *
 * It used to be a centred kicker and headline laid over a screenshot under
 * a heavy black scrim, which hid most of what the screenshot was there to
 * show. Now it is split the way the hero is: a rail on the left, pinned,
 * naming the three states with a line that fills as you move through them,
 * and the board on the right at full brightness, cross-fading between the
 * real captures.
 *
 * The dots are status, not decoration: green means connected and amber
 * means offline, the same as the app's own sync indicator.
 */

const STEPS = [
  {
    kicker: 'Online',
    title: 'File it.',
    body: 'Changes reach everyone on the board as you make them.',
    dot: 'bg-emerald-400',
    shot: '/shots/board.png',
    alt: 'The issue board with a live connection, everything synced.',
  },
  {
    kicker: 'Offline',
    title: 'Keep working.',
    body: 'Edits land in a queue on your device, and the board keeps taking them.',
    dot: 'bg-amber-300',
    shot: '/shots/offline.png',
    alt: 'The board with the network disabled, showing unsynced changes.',
  },
  {
    kicker: 'Reconnected',
    title: 'Nothing lost.',
    body: 'The queue drains in order, and a retry cannot create anything twice.',
    dot: 'bg-emerald-400',
    shot: '/shots/reconnected.png',
    alt: 'The same board after reconnecting, every queued change applied.',
  },
] as const;

export function OfflineStory() {
  const [refs, active] = useActiveStep(STEPS.length);

  return (
    <section className={CHAPTER_BG}>
      <div className={CHAPTER_FRAME}>
        <div className="border-t border-white/10 pt-[clamp(4.5rem,12vh,9rem)]">
          <ChapterTitle aside="Pull the cable mid-sentence. The board keeps taking edits, and every one of them lands when the network comes back.">
            Works without the network.
          </ChapterTitle>
        </div>

        <div className="hidden lg:block">
          {/* Pinned under the 4rem header, which is showing by now. */}
          <div className="sticky top-16 grid h-[calc(100svh-4rem)] grid-cols-12 items-center gap-x-12 py-[clamp(1.5rem,4vh,3rem)]">
            <ol className="relative col-span-4 space-y-10 pl-8">
              {/* The rail, and how far along it you are. */}
              <span aria-hidden="true" className="absolute inset-y-1 left-0 w-px bg-white/10" />
              <span
                aria-hidden="true"
                data-rail-fill=""
                style={{ '--progress': (active + 1) / STEPS.length } as CSSProperties}
                className="absolute inset-y-1 left-0 w-px origin-top bg-accent"
              />

              {STEPS.map((step, index) => (
                <li
                  key={step.kicker}
                  data-step=""
                  data-active={index === active}
                  aria-current={index === active ? 'step' : undefined}
                >
                  <p className="flex items-center gap-2 text-sm font-medium text-muted">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${step.dot}`} />
                    {step.kicker}
                  </p>
                  <p className="mt-2 text-[clamp(1.75rem,2.6vw,2.5rem)] font-semibold leading-none tracking-[-0.035em] text-content">
                    {step.title}
                  </p>
                  <p className="mt-3 max-w-[30ch] text-base leading-relaxed text-muted">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>

            <div className="relative col-span-8 aspect-[16/10] max-h-full w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/60">
              {/*
               * Zoomed onto the board: the captures carry wide empty margins
               * either side of the app, which left the columns small inside
               * the frame. Anchored near the top so the breadcrumb and the
               * sync status stay in. On a wrapper, because the cross-fade
               * owns each image's own transform.
               */}
              <div className="absolute inset-0 origin-[50%_6%] scale-[1.22]">
                {STEPS.map((step, index) => (
                  <Image
                    key={step.kicker}
                    src={step.shot}
                    alt={step.alt}
                    width={1440}
                    height={900}
                    sizes="900px"
                    data-frame=""
                    data-active={index === active}
                    // Only the showing frame is announced; the rail already
                    // names all three states.
                    aria-hidden={index !== active}
                    className="absolute inset-0 h-full w-full object-cover object-top"
                  />
                ))}
              </div>
            </div>
          </div>

          {/*
           * One spacer per step, as in the name stage: the sticky stage is in
           * flow, so the distance it stays pinned is just these. The last is
           * longer, so the final state is not cut short by the unpin.
           */}
          {STEPS.map((step, index) => (
            <div
              key={step.kicker}
              ref={refs[index]}
              aria-hidden="true"
              className={index === STEPS.length - 1 ? 'h-[55svh]' : 'h-[40svh]'}
            />
          ))}
        </div>

        {/* Below `lg` there is no room to pin anything, so the steps stack. */}
        <div className="space-y-[clamp(3rem,8vh,5rem)] py-[clamp(3rem,8vh,5rem)] lg:hidden">
          {STEPS.map((step) => (
            <Reveal key={step.kicker}>
              <p className="flex items-center gap-2 text-sm font-medium text-muted">
                <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${step.dot}`} />
                {step.kicker}
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-[-0.03em] text-content">
                {step.title}
              </p>
              <p className="mt-2 text-base text-muted">{step.body}</p>
              <Image
                src={step.shot}
                alt={step.alt}
                width={1440}
                height={900}
                sizes="100vw"
                className="mt-5 h-auto w-full rounded-xl border border-white/10"
              />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
