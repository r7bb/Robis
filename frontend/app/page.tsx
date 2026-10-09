'use client';

import { useQuery } from '@tanstack/react-query';
import { GeistSans } from 'geist/font/sans';
import Link from 'next/link';
import { Logo } from '../components/brand/logo.tsx';
import { Faq } from '../features/landing/faq.tsx';
import { SiteFooter } from '../features/landing/footer.tsx';
import { Hero } from '../features/landing/hero.tsx';
import { OfflineStory } from '../features/landing/offline-story.tsx';
import { SayIt } from '../features/landing/say-it.tsx';
import {
  Capabilities,
  Closing,
  Decisions,
  Documents,
  REPO,
  Stack,
} from '../features/landing/sections.tsx';
import { ShippedFeatures } from '../features/landing/shipped.tsx';
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
      {/*
       * No header on the first screen. The wordmark is the name and the hero
       * carries both actions, so a nav bar above them would say everything
       * twice. Once the wordmark has scrolled away the header slides in and
       * takes the name over as a link. `scrolled` flips when the sentinel
       * under the wordmark leaves the top of the viewport.
       *
       * `inert` while hidden: an invisible header whose links still take
       * focus would be a keyboard trap nobody can see.
       */}
      <header
        data-landing-nav=""
        data-shown={scrolled}
        inert={!scrolled}
        className="fixed inset-x-0 top-0 z-40 border-b border-line/70 bg-surface/80 shadow-lg shadow-black/20 backdrop-blur-xl"
      >
        <nav className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-[clamp(1rem,3vw,2.5rem)]">
          <Link
            href="/"
            className="text-content transition-opacity duration-[var(--micro)] ease-[var(--ease)] hover:opacity-80"
          >
            <Logo size={32} />
          </Link>

          <div className="ml-auto flex items-center gap-5 text-sm">
            <Link
              href="/whats-new"
              className="text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content"
            >
              What's new
            </Link>
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
        <Hero href={href} label={label} sentinel={sentinel} />
        <OfflineStory />
        <Documents />
        <Capabilities />
        <Decisions />
        {/* Next to the decisions: what the page just argued against is
            exactly what is missing from this list. */}
        <Stack />
        <SayIt />
        <ShippedFeatures />
        <Faq />
        <Closing href={href} label={label} />
      </main>

      <SiteFooter />
    </div>
  );
}
