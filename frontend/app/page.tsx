'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Logo } from '../components/brand/logo.tsx';
import {
  Capabilities,
  Closing,
  Decisions,
  Hero,
  Measurements,
  OfflineStory,
  REPO,
} from '../features/landing/sections.tsx';
import { useScrolled } from '../features/landing/use-scroll.ts';
import { api, type Me } from '../lib/api.ts';

/**
 * The landing page.
 *
 * This route used to bounce straight to `/login`, so anyone arriving from
 * the repository met a password field and had to take the architecture on
 * faith. It now walks through the product: what it is, what happens when
 * the network dies, what it measures, and why it is built the way it is.
 *
 * Every figure is measured and every screenshot is the real app. There is
 * no customer logo wall, because Relay has no customers and inventing some
 * would be the one dishonest thing on a page like this.
 */
export default function Home() {
  // `retry: false`: a 401 is the expected answer for a visitor, not a
  // failure worth retrying. The page renders either way.
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
  });

  const [sentinel, scrolled] = useScrolled();

  const signedIn = Boolean(data?.user);
  const href = signedIn ? '/workspaces' : '/login';
  const label = signedIn ? 'Open your workspaces' : 'Get started';

  return (
    <div className="min-h-[100dvh] bg-surface">
      {/* Watched instead of the scroll position: this element leaving the
          viewport is exactly the question the nav needs answered. */}
      <div ref={sentinel} aria-hidden="true" className="absolute top-0 h-px w-full" />

      <header
        data-nav=""
        className={`sticky top-0 z-40 border-b backdrop-blur-xl ${
          scrolled
            ? 'border-line/70 bg-surface/80 shadow-lg shadow-black/20'
            : 'border-transparent bg-transparent shadow-none'
        }`}
      >
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
          <Link
            href="/"
            className="text-content transition-opacity duration-[--micro] ease-[--ease] hover:opacity-80"
          >
            <Logo size={32} />
          </Link>

          <div className="ml-auto flex items-center gap-5 text-sm">
            <a
              href={`${REPO}#architecture`}
              className="hidden text-muted transition-colors duration-[--micro] ease-[--ease] hover:text-content sm:block"
            >
              Architecture
            </a>
            <a
              href={REPO}
              className="hidden text-muted transition-colors duration-[--micro] ease-[--ease] hover:text-content sm:block"
            >
              Source
            </a>

            <Link
              href={href}
              className="rounded-full bg-accent px-4 py-1.5 font-semibold text-accent-contrast transition-colors duration-[--micro] ease-[--ease] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {label}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <Hero href={href} label={label} />
        <OfflineStory />
        <Measurements />
        <Capabilities />
        <Decisions />
        <Closing href={href} label={label} />
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-xs text-faint">
          <Logo
            size={20}
            className="text-faint"
            markClassName="text-accent/70"
            wordClassName="text-sm"
          />
          <a
            href={REPO}
            className="transition-colors duration-[--micro] ease-[--ease] hover:text-muted"
          >
            GitHub
          </a>
          <Link
            href="/login"
            className="transition-colors duration-[--micro] ease-[--ease] hover:text-muted"
          >
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}
