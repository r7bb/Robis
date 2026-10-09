'use client';

import { useQuery } from '@tanstack/react-query';
import { GeistSans } from 'geist/font/sans';
import Link from 'next/link';
import { Logo } from '../components/brand/logo.tsx';
import { Faq } from '../features/landing/faq.tsx';
import { SiteFooter } from '../features/landing/footer.tsx';
import { Hero } from '../features/landing/hero.tsx';
import { SayIt } from '../features/landing/say-it.tsx';
import {
  Capabilities,
  Closing,
  Decisions,
  Documents,
  OfflineStory,
  REPO,
  Stack,
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
 * no customer logo wall, because Robis has no customers and inventing some
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
    // Geist on the landing page only. The wordmark needs a heavy grotesk to
    // read as deliberate, and the system stack renders it differently on
    // every OS. The signed-in app keeps the system font it was designed in.
    <div className={`min-h-[100dvh] bg-surface ${GeistSans.className}`}>
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
            className="text-content transition-opacity duration-[var(--micro)] ease-[var(--ease)] hover:opacity-80"
          >
            <Logo size={32} />
          </Link>

          <div className="ml-auto flex items-center gap-5 text-sm">
            <Link
              href="/how-it-works"
              className="hidden text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content sm:block"
            >
              How it works
            </Link>
            <a
              href={REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content sm:block"
            >
              Source
            </a>

            <Link
              href={href}
              className="rounded-full bg-accent px-4 py-1.5 font-semibold text-accent-contrast transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {label}
            </Link>
          </div>
        </nav>
      </header>

      <main>
        <Hero href={href} label={label} />
        <OfflineStory />
        <Stack />
        <Documents />
        <Capabilities />
        <Decisions />
        <SayIt />
        <Faq />
        <Closing href={href} label={label} />
      </main>

      <SiteFooter />
    </div>
  );
}
