'use client';

import { CHECK_IN_MAX_LENGTH, contracts } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { feedKey } from './feed-model.ts';

/**
 * The weekly check-in (Phase 2c): "What are you working on this week?",
 * once a week, on your own feed. The answer is a post, and your profile's
 * Working on line. It is a question, never a chore: Not this week puts it
 * away until Monday, and nobody is told who answered and who did not.
 */

/** Monday of this week, UTC, as a date: the key a "Not this week" is kept under. */
function thisWeek(): string {
  const now = new Date();
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
    ),
  );
  return monday.toISOString().slice(0, 10);
}

const PUT_AWAY_KEY = 'robis.checkin.away';

function putAwayThisWeek(): boolean {
  try {
    return localStorage.getItem(PUT_AWAY_KEY) === thisWeek();
  } catch {
    return false;
  }
}

export function CheckIn({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [away, setAway] = useState(true);
  const [body, setBody] = useState('');
  useEffect(() => setAway(putAwayThisWeek()), []);

  const share = useMutation({
    mutationFn: () => call(contracts['posts.checkIn'], { params: { workspaceId }, body: { body } }),
    onSuccess: async () => {
      setBody('');
      await queryClient.invalidateQueries({ queryKey: feedKey(workspaceId) });
      await queryClient.invalidateQueries({ queryKey: ['profile', workspaceId] });
    },
  });

  if (away) return null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (body.trim()) share.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-labelledby={`${fieldId}-title`}
      className="mt-6 rounded-xl border border-accent-soft/40 bg-accent/[0.07] p-4"
    >
      <p
        id={`${fieldId}-title`}
        className="text-xs font-medium uppercase tracking-wide text-accent-soft"
      >
        This week’s check-in
      </p>
      <label htmlFor={fieldId} className="mt-1 block text-sm font-medium text-content">
        What are you working on this week?
      </label>
      <textarea
        id={fieldId}
        name="check-in"
        autoComplete="off"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={CHECK_IN_MAX_LENGTH}
        rows={2}
        placeholder="The onboarding redesign, then the pricing page…"
        className="mt-2 w-full resize-none rounded-md border border-line bg-surface px-3 py-2 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none"
      />
      <p className="mt-1 text-xs text-faint">
        It goes on the feed, and its first line becomes your Working on.
      </p>
      <div aria-live="polite">
        {share.error ? (
          <p className="mt-2 text-xs text-danger-soft">
            {share.error instanceof ApiError ? share.error.message : 'That did not share.'}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(PUT_AWAY_KEY, thisWeek());
            } catch {
              // Without storage it simply asks again next visit.
            }
            setAway(true);
          }}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Not this week
        </button>
        <button
          type="submit"
          disabled={!body.trim() || share.isPending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {share.isPending ? 'Sharing…' : 'Share'}
        </button>
      </div>
    </form>
  );
}
