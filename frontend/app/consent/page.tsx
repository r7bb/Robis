'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ConsentFlow } from '../../features/account/consent-flow.tsx';
import { safeNext } from '../../lib/safe-next.ts';

function Consent() {
  return <ConsentFlow next={safeNext(useSearchParams().get('next'))} />;
}

/** `useSearchParams` needs a boundary so the route can still be prerendered. */
export default function ConsentPage() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh]" />}>
      <Consent />
    </Suspense>
  );
}
