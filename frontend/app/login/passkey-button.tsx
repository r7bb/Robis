'use client';

import { contracts } from '@robis/shared';
import { browserSupportsWebAuthn, startAuthentication } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';

/**
 * Sign in with a passkey (C4): no address asked, as the passkey says whose
 * it is. Shown only where the browser can use one. Closing the browser's
 * prompt is not an error worth a red box.
 */
export function PasskeyButton({
  onSignedIn,
  onError,
}: {
  onSignedIn: (userId: string) => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [working, setWorking] = useState(false);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);
  if (!supported) return null;

  async function signIn() {
    onError(null);
    setWorking(true);
    try {
      const { challengeId, options } = await call(contracts['auth.passkeyOptions'], {});
      const response = await startAuthentication({ optionsJSON: options as never });
      const signedIn = await call(contracts['auth.passkeyLogin'], {
        body: { challengeId, response: response as never },
      });
      await onSignedIn(signedIn.user.id);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'NotAllowedError') return;
      onError(cause instanceof ApiError ? cause.message : 'That passkey could not be used.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 text-xs text-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <button
        type="button"
        onClick={signIn}
        disabled={working}
        className="mt-4 w-full rounded-md border border-line px-3 py-2 text-sm font-medium text-content transition hover:bg-raised active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface motion-reduce:transition-none disabled:opacity-50"
      >
        {working ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
      </button>
    </div>
  );
}
