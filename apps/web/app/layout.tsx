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
      <body>
        <ServiceWorker />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
