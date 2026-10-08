import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { ServiceWorker } from '../components/service-worker.tsx';
import { Providers } from './providers.tsx';

export const metadata: Metadata = {
  title: 'Relay',
  description: 'Collaborative workspace for issues, projects and documents.',
};

/**
 * Matches the default theme's surface, so mobile browser chrome blends with
 * the page instead of framing it in white. Themes are per-workspace and
 * applied at runtime, so this is the first-paint value rather than the live
 * one.
 */
export const viewport: Viewport = {
  themeColor: '#0e1014',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      {/*
       * Extensions write to `<body>` before React hydrates.
       *
       * Password managers, antivirus and reader extensions add their own
       * attributes (`bis_register`, `bis_skin_checked`, `cz-shortcut-listen`
       * and friends) to `<html>` and `<body>` as the document parses. React
       * compares the server HTML against the DOM, sees an attribute it did
       * not write, and reports a hydration failure the application cannot
       * fix and the developer cannot reproduce without that exact extension
       * installed.
       *
       * This suppresses the warning for this element's own attributes only.
       * A genuine mismatch anywhere inside still fails loudly, which is why
       * it goes here rather than on a wrapper further down.
       */}
      <body suppressHydrationWarning>
        <ServiceWorker />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
