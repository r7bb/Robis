'use client';

import { GeistSans } from 'geist/font/sans';
import { Intro } from '../../features/start/intro.tsx';

/**
 * Where "Get started" goes: a short look at what Robis does, then the
 * sign-up form. Geist, like the landing page it is reached from.
 */
export default function StartPage() {
  return (
    <main className={GeistSans.className}>
      <h1 className="sr-only">Getting started with Robis</h1>
      <Intro />
    </main>
  );
}
