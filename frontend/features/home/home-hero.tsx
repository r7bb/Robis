'use client';

import { type CSSProperties, type ReactNode, useSyncExternalStore } from 'react';
import { ActivityRiver, type RiverSeries } from './activity-river.tsx';
import { greetingFor, type SparkSignal } from './describe.ts';
import { paletteFor } from './hero-scene.ts';
import { LiveNumber } from './live-number.tsx';

const noSubscription = () => () => {};

/** The browser's hour, and none while rendering on the server. */
function useHour(): number | null {
  return useSyncExternalStore(
    noSubscription,
    () => new Date().getHours(),
    () => null,
  );
}

/**
 * The top of the signed-in home: the greeting and the live counts beside
 * a river of the last two weeks across your workspaces, which ripples as
 * your teammates work (`activity-river.tsx`), over an aurora in the
 * colours of the hour.
 */
export function HomeHero({
  firstName,
  series,
  spark,
  offline,
  connected,
  partial,
  here,
  waiting,
  open,
  actions,
}: {
  firstName: string | undefined;
  series: readonly RiverSeries[];
  spark: SparkSignal | null;
  offline: boolean;
  /** Until a connection is live, nothing is said about who is here. */
  connected: boolean;
  /** Only the first few workspaces are live; say so rather than claim all. */
  partial: boolean;
  here: number;
  /** Null until the overview loads: a 0 then would count up as a rise. */
  waiting: number | null;
  open: number | null;
  actions: ReactNode;
}) {
  // In the browser's time zone, so never during the server render, which
  // would not match it.
  const hour = useHour();
  // Evening until the browser says otherwise: the server has no hour to give.
  const palette = paletteFor(hour ?? 21);
  const greeting = `${hour === null ? 'Welcome back' : greetingFor(hour)}${firstName ? `, ${firstName}` : ''}`;

  return (
    <section className="relative isolate overflow-hidden bg-[#08090c]">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={
          {
            '--aurora-a': palette.a,
            '--aurora-b': palette.b,
            '--aurora-c': series[0]?.accent ?? palette.a,
          } as CSSProperties
        }
      >
        <div className="home-aurora">
          <span className="home-aurora-blob home-aurora-a" />
          <span className="home-aurora-blob home-aurora-b" />
          <span className="home-aurora-blob home-aurora-c" />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(8_9_12/0.45),transparent_38%,transparent_80%,rgb(var(--surface))_100%)]" />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 lg:pb-24">
        <nav aria-label="Account" className="flex items-center justify-end gap-4">
          {actions}
        </nav>

        <div className="grid items-end gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h1
              id="workspaces-heading"
              tabIndex={-1}
              className="home-rise mt-12 text-4xl font-semibold leading-[1.05] tracking-tight text-content focus:outline-none sm:mt-16 sm:text-5xl"
            >
              {greeting}
            </h1>

            <p className="home-rise mt-4 max-w-2xl text-base text-muted [animation-delay:90ms] sm:text-lg">
              <WhoIsHere connected={connected} partial={partial} here={here} />,{' '}
              <span className="text-content">
                <Count value={waiting} />
              </span>{' '}
              {waiting === 1 ? 'issue waits' : 'issues wait'} on you, and{' '}
              <span className="text-content">
                <Count value={open} />
              </span>{' '}
              open across your workspaces.
            </p>
          </div>
          <div className="home-rise [animation-delay:160ms]">
            <ActivityRiver series={series} spark={spark} offline={offline} />
          </div>
        </div>
      </div>
    </section>
  );
}

/** A live count once it is known, "…" before. */
function Count({ value }: { value: number | null }) {
  return value === null ? <>…</> : <LiveNumber value={value} />;
}

/** The first clause of the hero's sentence: who else is here, truthfully. */
function WhoIsHere({
  connected,
  partial,
  here,
}: {
  connected: boolean;
  partial: boolean;
  here: number;
}) {
  if (!connected) return <>Connecting to your workspaces</>;
  if (here === 0) {
    return (
      <>
        {partial ? 'Nobody else in your first six workspaces right now' : 'Just you here right now'}
      </>
    );
  }
  return (
    <>
      <span className="text-content">
        <LiveNumber value={here} />
      </span>{' '}
      {here === 1 ? 'person' : 'people'} here now
      {partial ? ' in your first six workspaces' : ''}
    </>
  );
}
