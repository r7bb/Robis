'use client';

import { ShareView } from '../../features/share/share-view.tsx';
import { lastTheme, useApplyTheme } from '../../lib/theme.ts';

/** Where a photo or link shared to Robis from another app lands (C8). */
export default function SharePage() {
  useApplyTheme(lastTheme());
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10">
      <h1 className="text-xl font-semibold tracking-tight text-content">Shared to Robis</h1>
      <p className="mt-1 text-sm text-muted">
        Pick the board it goes on; it becomes an issue there.
      </p>
      <div className="mt-6">
        <ShareView />
      </div>
    </main>
  );
}
