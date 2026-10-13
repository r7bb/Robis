'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { WelcomeFlow } from '../../features/welcome/welcome-flow.tsx';
import { safeNext } from '../../lib/safe-next.ts';

function Welcome() {
  return <WelcomeFlow next={safeNext(useSearchParams().get('next'))} />;
}

/** `useSearchParams` needs a boundary so the route can still be prerendered. */
export default function WelcomePage() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh]" />}>
      <Welcome />
    </Suspense>
  );
}
