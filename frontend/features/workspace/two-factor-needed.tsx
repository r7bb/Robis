import Link from 'next/link';

/**
 * What a member sees on opening a workspace that requires two-factor
 * sign-in (C4) before they have it: why, and the one thing that fixes it.
 */
export function TwoFactorNeeded({ message }: { message: string }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-surface px-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-raised p-6">
        <h1 className="text-lg font-semibold tracking-tight text-content">
          Two-factor sign-in needed
        </h1>
        <p className="mt-2 text-sm text-muted">{message}</p>
        <p className="mt-2 text-sm text-muted">
          It takes a minute: scan a code with an authenticator app on your phone, and type the
          number it shows.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/account#two-factor"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Turn on two-factor
          </Link>
          <Link
            href="/workspaces"
            className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Back to your workspaces
          </Link>
        </div>
      </div>
    </main>
  );
}
