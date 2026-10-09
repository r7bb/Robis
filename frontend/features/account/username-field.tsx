'use client';

import { USERNAME_HINT, USERNAME_MAX_LENGTH, usernameProblem } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { api } from '../../lib/api.ts';
import { useDebounced } from '../../lib/use-debounced.ts';

/** Long enough that a typist is not checked mid-word. */
const CHECK_DELAY_MS = 350;

type Availability = { username: string; available: boolean; reason: string | null };

const REASONS: Record<string, string> = {
  length: 'Use 3 to 30 characters.',
  characters: USERNAME_HINT,
  reserved: 'That name is reserved.',
  taken: 'Someone already has that one.',
};

/** What to say under the field, from what is known so far. */
function messageFor(
  candidate: string,
  localProblem: string | null,
  current: string | undefined,
  waiting: boolean,
  answer: Availability | undefined,
  failed: boolean,
): string {
  if (!candidate) return 'This is how people mention you: @name.';
  if (localProblem) return REASONS[localProblem] ?? USERNAME_HINT;
  if (candidate === current) return 'This is your username.';
  // The check is a convenience; the server decides at submit either way.
  if (failed && !waiting) return "Couldn't check just now. We'll confirm when you save.";
  if (waiting || !answer) return 'Checking…';
  if (answer.available) return `@${candidate} is yours if you want it.`;
  return REASONS[answer.reason ?? 'taken'] ?? 'Someone already has that one.';
}

/**
 * A username input that says, while you type, whether you can have it.
 *
 * The format is checked here with the same rule the API uses, so most
 * answers need no request at all; only a well-formed name is sent to ask
 * whether it is free. The server stays the authority -- a race at submit
 * still comes back as a clear 409.
 */
export function UsernameField({
  value,
  onChange,
  current,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The name already held, which counts as available. */
  current?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const candidate = value.trim().toLowerCase();
  const settled = useDebounced(candidate, CHECK_DELAY_MS);
  const localProblem = candidate ? usernameProblem(candidate) : null;

  const check = useQuery({
    queryKey: ['username-available', settled],
    queryFn: () =>
      api<Availability>(`/auth/username-available?username=${encodeURIComponent(settled)}`),
    enabled: settled.length > 0 && usernameProblem(settled) === null && settled !== current,
    staleTime: 30_000,
    retry: false,
  });

  const waiting = settled !== candidate || check.isFetching;
  const message = messageFor(candidate, localProblem, current, waiting, check.data, check.isError);
  const bad =
    Boolean(localProblem) || (candidate !== current && !waiting && check.data?.available === false);

  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1 block text-xs font-medium text-muted">Username</span>
      <span className="flex items-center rounded-md border border-line bg-raised focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/60">
        <span aria-hidden="true" className="pl-3 text-sm text-faint">
          @
        </span>
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={USERNAME_MAX_LENGTH}
          aria-describedby={hintId}
          aria-invalid={bad || undefined}
          required
          className="w-full bg-transparent py-2 pl-1 pr-3 text-sm text-content outline-none"
        />
      </span>
      <span
        id={hintId}
        aria-live="polite"
        className={`mt-1 block text-xs ${bad ? 'text-danger-soft' : 'text-faint'}`}
      >
        {message}
      </span>
    </label>
  );
}
