import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared frame for the legal pages.
 *
 * Both are placeholders written for a portfolio project, not legal advice,
 * and say so at the top in words nobody can miss. They describe what the
 * code stores and does, and claim nothing about compliance with anything.
 */
export function DraftLegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <nav className="text-sm text-faint">
        <Link href="/" className="hover:text-muted">
          Robis
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted">{title}</span>
      </nav>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-content">{title}</h1>

      <p
        role="note"
        className="mt-4 rounded-md border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-content"
      >
        Draft for legal review. This is a placeholder for a portfolio project and has not been
        reviewed by a lawyer. Do not rely on it.
      </p>

      <div className="mt-8 space-y-5 text-sm leading-relaxed text-muted [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-content">
        {children}
      </div>
    </main>
  );
}
