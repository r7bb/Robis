'use client';

import { GeistSans } from 'geist/font/sans';
import Link from 'next/link';
import { Logo } from '../../components/brand/logo.tsx';
import { CHAPTER_BG, CHAPTER_FRAME } from '../../features/landing/chapter.tsx';
import { SiteFooter } from '../../features/landing/footer.tsx';
import { Reveal } from '../../features/landing/motion.tsx';
import { WhatsNew } from '../../features/landing/whats-new.tsx';

/**
 * The full changelog, on its own page.
 *
 * The landing page shows only what can be used end to end; this is the
 * rest as well -- measurements, hardening, and the experiments that were
 * tried and not adopted -- each with how it was checked. Same data as the
 * README's "What's new", kept in step by `tests/changelog.test.ts`.
 */
export default function WhatsNewPage() {
  return (
    <div className={`min-h-[100dvh] bg-surface ${GeistSans.className}`}>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/80 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-[1400px] items-center gap-6 px-[clamp(1rem,3vw,2.5rem)]">
          <Link
            href="/"
            className="text-content transition-opacity duration-[var(--micro)] ease-[var(--ease)] hover:opacity-80"
          >
            <Logo size={32} />
          </Link>

          <div className="ml-auto flex items-center gap-5 text-sm">
            <Link
              href="/"
              className="text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content"
            >
              Overview
            </Link>
            <Link
              href="/how-it-works"
              className="hidden text-muted transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:text-content sm:block"
            >
              How it works
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-accent px-4 py-1.5 font-semibold text-accent-contrast transition-colors duration-[var(--micro)] ease-[var(--ease)] hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              Get started
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* The chapter's own background and frame, so the title and the list
            read as one surface rather than two bands. */}
        <section className={CHAPTER_BG}>
          <div className={`${CHAPTER_FRAME} -mb-[clamp(2rem,6vh,5rem)] pt-[clamp(4rem,10vh,7rem)]`}>
            <Reveal>
              <h1 className="text-[clamp(2.75rem,6vw,5.5rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-content">
                What's new
              </h1>
            </Reveal>
          </div>
        </section>
        <WhatsNew standalone />
      </main>

      <SiteFooter />
    </div>
  );
}
