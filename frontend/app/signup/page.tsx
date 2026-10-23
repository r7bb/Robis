'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SignupForm } from './signup-form.tsx';

function Signup() {
  const params = useSearchParams();
  // Read once and kept: clearing the address bar below updates the params.
  const [token] = useState(() => params.get('token'));

  // The link is a credential until it is used. Taking it out of the address
  // bar keeps it out of history, bookmarks and a shared screen.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('token')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  return <SignupForm token={token} />;
}

/** `useSearchParams` needs a boundary so the route can still be prerendered. */
export default function SignupPage() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh]" />}>
      <Signup />
    </Suspense>
  );
}
