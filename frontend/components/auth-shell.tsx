'use client';

import Link from 'next/link';

/**
 * Shared chrome for the signed-out pages.
 *
 * Login, forgot-password, reset-password and verify-email are the same
 * composition: one centred column, the product name, a line of orientation,
 * then a short form. Extracting it keeps those four from drifting apart, which
 * is how an auth flow ends up feeling like four different products.
 *
 * Centred on purpose. The anti-centre bias that applies to a marketing hero
 * does not apply here: a credential form is a single focused task, and
 * off-centre composition on a trust surface reads as a mistake rather than as
 * a decision.
 *
 * `min-h-[100dvh]` rather than `min-h-screen`: on iOS Safari `100vh` counts
 * the area behind the address bar, so a centred column visibly jumps when the
 * bar collapses.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-content">Robis</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>

        <h2 className="mt-8 text-sm font-medium text-content">{title}</h2>

        {children}

        {footer && <div className="mt-6 text-sm text-muted">{footer}</div>}
      </div>
    </main>
  );
}

/**
 * A labelled field.
 *
 * The label sits above the input and is always rendered: a placeholder is not
 * a label, because it disappears as soon as someone types and leaves
 * screen-reader users with nothing.
 *
 * Focus shows a ring rather than only recolouring the 1px border. Swapping a
 * border colour is a very small change to notice when the keyboard is the only
 * way you move through a form.
 */
export function AuthField({
  label,
  value,
  onChange,
  id,
  type = 'text',
  hint,
  error,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id: string;
  type?: string;
  hint?: string;
  error?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>

      <input
        {...rest}
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        // An address is not prose: red squiggles under it are noise, and the
        // email keyboard is the right one on a phone.
        spellCheck={type === 'email' ? false : undefined}
        inputMode={type === 'email' ? 'email' : undefined}
        className={[
          'w-full rounded-md border bg-raised px-3 py-2 text-sm text-content',
          'outline-none transition focus-visible:ring-2 focus-visible:ring-accent/60',
          error ? 'border-danger' : 'border-line focus-visible:border-accent',
        ].join(' ')}
      />

      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-faint">
          {hint}
        </p>
      )}

      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger-soft">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The primary action.
 *
 * `active:translate-y-px` gives the press somewhere to land. Both the
 * transition and the nudge drop out under `prefers-reduced-motion`, which
 * Tailwind's `motion-reduce` variant handles.
 */
export function AuthButton({
  children,
  disabled,
  type = 'submit',
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={[
        'w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-contrast',
        'transition hover:bg-accent-hover active:translate-y-px',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'motion-reduce:transition-none motion-reduce:active:translate-y-0',
        'disabled:opacity-50 disabled:active:translate-y-0',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/** A form-level failure. `role="alert"` so it is announced, not merely shown. */
export function AuthError({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger-soft">
      {message}
    </p>
  );
}

/** Confirmation after something that cannot be undone, such as a password change. */
export function AuthNotice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-line bg-raised px-3 py-3 text-sm text-muted">
      {children}
    </p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded text-muted underline-offset-4 transition hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </Link>
  );
}
