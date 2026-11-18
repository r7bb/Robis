'use client';

import { contracts } from '@robis/shared';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api.ts';
import { applicationServerKey } from '../../lib/push-key.ts';

/**
 * Pushes on this device (C3): asks the browser's leave, subscribes with the
 * server's key, and tells the server only the endpoint. A push shows a
 * fixed "something new" prompt and nothing else.
 */

type State = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on' | 'busy';

const SUPPORTED = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** The two keys as bytes, for comparing. */
function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.byteLength) return false;
  const left = new Uint8Array(a);
  return left.every((byte, i) => byte === b[i]);
}

/**
 * What this browser holds, squared with the server when the page opens: a
 * subscription made with an older key is dropped (it can never be pushed
 * to), and one still good is offered again, which claims it for whoever is
 * signed in now and restores it if the server let it go. True when on.
 */
async function resync(publicKey: string): Promise<boolean> {
  const subscription = await currentSubscription();
  if (!subscription) return false;
  if (!sameKey(subscription.options.applicationServerKey, applicationServerKey(publicKey))) {
    await subscription.unsubscribe();
    return false;
  }
  await call(contracts['pushSubscriptions.add'], { body: { endpoint: subscription.endpoint } });
  return true;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export function PushDevice({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<State>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!SUPPORTED()) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    void resync(publicKey)
      .then((on) => setState(on ? 'on' : 'off'))
      .catch(() => setState('off'));
  }, [publicKey]);

  async function turnOn() {
    setState('busy');
    setError(null);
    try {
      // Asked from the button press, as browsers require.
      const permission = await Notification.requestPermission();
      if (permission === 'denied') return setState('blocked');
      if (permission !== 'granted') {
        // The prompt was closed without an answer: nothing is blocked yet.
        setError('Allow notifications when the browser asks, to turn this on.');
        return setState('off');
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      });
      await call(contracts['pushSubscriptions.add'], { body: { endpoint: subscription.endpoint } });
      setState('on');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Push could not be turned on.');
      setState('off');
    }
  }

  async function turnOff() {
    setState('busy');
    setError(null);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await call(contracts['pushSubscriptions.remove'], {
          body: { endpoint: subscription.endpoint },
        });
        await subscription.unsubscribe();
      }
      setState('off');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Push could not be turned off.');
      setState('on');
    }
  }

  const note: Record<State, string> = {
    checking: '',
    unsupported:
      'This browser does not take pushes. On an iPhone or iPad, add Robis to your Home Screen first.',
    blocked:
      'Notifications are blocked for this site; allow them in the browser’s settings to turn this on.',
    off: 'Off on this device.',
    on: 'On for this device. A push only says something is new; open Robis to see what.',
    busy: '',
  };

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-raised px-4 py-3 text-sm">
      <p className="min-w-0 flex-1 text-muted" aria-live="polite">
        {error ? <span className="text-danger-soft">{error}</span> : note[state]}
      </p>
      {(state === 'off' || state === 'on' || state === 'busy') && (
        <button
          type="button"
          onClick={state === 'on' ? turnOff : turnOn}
          disabled={state === 'busy'}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-content transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {state === 'on'
            ? 'Turn off on this device'
            : state === 'busy'
              ? 'One moment…'
              : 'Turn on for this device'}
        </button>
      )}
    </div>
  );
}

/**
 * On signing out: stop pushes to this browser, so a shared or borrowed
 * computer does not keep prompting for the account that left. Never in the
 * way of signing out: a failure here is logged and passed over.
 */
export async function forgetThisDevice(): Promise<void> {
  try {
    if (!SUPPORTED()) return;
    const subscription = await currentSubscription();
    if (!subscription) return;
    await call(contracts['pushSubscriptions.remove'], {
      body: { endpoint: subscription.endpoint },
    });
    await subscription.unsubscribe();
  } catch (error) {
    console.warn('could not stop pushes to this device', error);
  }
}
