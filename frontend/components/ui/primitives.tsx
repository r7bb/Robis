import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The small shared vocabulary every screen is built from.
 *
 * These existed as copied class strings across a dozen files, which is how a
 * design drifts: one card gets a different radius, one button a different
 * disabled state, and nobody notices until they are side by side. Naming them
 * makes a change one edit instead of twelve.
 */

const VARIANTS = {
  primary: 'bg-accent text-accent-contrast hover:bg-accent-hover',
  secondary: 'border border-line bg-raised text-content hover:border-accent-soft',
  ghost: 'text-muted hover:bg-raised hover:text-content',
  danger: 'border border-danger/40 text-danger-soft hover:bg-danger hover:text-danger-contrast',
} as const;

const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
} as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      // Defaulted to "button": an unqualified <button> inside a form submits
      // it, which has caused real bugs here before.
      type={type === 'submit' ? 'submit' : 'button'}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    />
  );
}

/** A section heading inside a panel: small, quiet, and consistently spaced. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">{children}</h3>
      {action}
    </div>
  );
}

/**
 * What to show when a list is legitimately empty.
 *
 * Distinct from an error on purpose. "No meetings scheduled" and "we could
 * not load your meetings" look identical if both render as blank space, and
 * the difference decides whether the reader should retry or relax.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-xs text-faint">
      {children}
    </p>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-xs text-danger-soft">
      {children}
    </p>
  );
}

/** A count beside a label, e.g. the number of unanswered invitations. */
export function Pill({
  children,
  tone = 'muted',
}: {
  children: ReactNode;
  tone?: 'muted' | 'accent';
}) {
  const styles =
    tone === 'accent'
      ? 'border-accent-soft/40 bg-accent/15 text-accent-soft'
      : 'border-line text-faint';

  return (
    <span className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
      {role}
    </span>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <p className="text-sm text-muted">{message}</p>
      <Link
        href="/workspaces"
        className="mt-4 inline-block text-sm text-accent-soft hover:underline"
      >
        Back to workspaces
      </Link>
    </main>
  );
}
