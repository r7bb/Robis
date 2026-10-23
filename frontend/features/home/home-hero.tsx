'use client';

import { type ReactNode, useSyncExternalStore } from 'react';
import { Field } from '../landing/field.tsx';
import type { FieldMode } from '../landing/field-modes.ts';
import { greetingFor } from './describe.ts';
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
 * The top of the signed-in home: the landing's field of points, now acting
 * out your own workspaces. Each live event sends a ring across it; it
 * quickens while someone else is here and greys when the connection drops.
 * The greeting and the live counts sit over it.
 */
export function HomeHero({
  firstName,
  mode,
  pulse,
  connected,
  partial,
  here,
  waiting,
  open,
  actions,
}: {
  firstName: string | undefined;
  mode: FieldMode;
  pulse: number;
  /** Until a connection is live, nothing is said about who is here. */
  connected: boolean;
  /** Only the first few workspaces are live; say so rather than claim all. */
  partial: boolean;
  here: number;
  waiting: number;
  open: number;
  actions: ReactNode;
}) {
  // In the browser's time zone, so never during the server render, which
  // would not match it.
  const hour = useHour();
  const greeting = `${hour === null ? 'Welcome back' : greetingFor(hour)}${firstName ? `, ${firstName}` : ''}`;

  return (
    <section className="relative isolate overflow-hidden bg-[#08090c]">
      <div aria-hidden="true" className="absolute inset-0 -z-10">
        <Field mode={mode} pulse={pulse} />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(8_9_12/0.6),transparent_38%,transparent_55%,rgb(var(--surface))_92%)]" />
      </div>

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pb-24">
        <nav aria-label="Account" className="flex items-center justify-end gap-4">
          {actions}
        </nav>

        <h1
          id="workspaces-heading"
          tabIndex={-1}
          className="home-rise mt-12 text-4xl font-semibold leading-[1.05] tracking-tight text-content focus:outline-none sm:mt-16 sm:text-5xl"
        >
          {greeting}
        </h1>

        <p className="home-rise mt-4 max-w-2xl text-base text-muted [animation-delay:90ms] sm:text-lg">
          {!connected ? (
            'Connecting to your workspaces'
          ) : here === 0 ? (
            partial ? (
              'Nobody else in your first six workspaces right now'
            ) : (
              'Just you here right now'
            )
          ) : (
            <>
              <span className="text-content">
                <LiveNumber value={here} />
              </span>{' '}
              {here === 1 ? 'person' : 'people'} here now
              {partial ? ' in your first six workspaces' : ''}
            </>
          )}
          ,{' '}
          <span className="text-content">
            <LiveNumber value={waiting} />
          </span>{' '}
          {waiting === 1 ? 'issue waits' : 'issues wait'} on you, and{' '}
          <span className="text-content">
            <LiveNumber value={open} />
          </span>{' '}
          open across your workspaces.
        </p>
      </div>
    </section>
  );
}
