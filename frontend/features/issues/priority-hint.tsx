'use client';

import type { IssuePriority } from '@robis/shared';
import { PriorityBadge } from '../../components/ui/badges.tsx';
import { useSuggestions } from './use-suggestions.ts';

/**
 * "This reads like a high-priority issue."
 *
 * Under the composer, beside the duplicate hints. The priority model only
 * ever suggests: nothing is chosen until somebody presses Use, and a chosen
 * priority can be cleared again before the issue is filed.
 *
 * Three ways it can answer, and each is shown for what it is:
 * - a suggestion, with the model's score so a weak one looks weak;
 * - a refusal, when the workspace has too few triaged issues to learn from,
 *   said plainly with the counts rather than hidden, because a model that
 *   declines is the honest one;
 * - nothing, when the service is off or failing. Then the composer looks as
 *   it did before this existed.
 */

export function PriorityHint({
  workspaceId,
  title,
  chosen,
  onChoose,
}: {
  workspaceId: string;
  title: string;
  /** The priority the new issue will be filed with, if one has been picked. */
  chosen: IssuePriority | null;
  onChoose: (priority: IssuePriority | null) => void;
}) {
  // Shared with the duplicate hints: one request for both, which keeps
  // coming while a priority is chosen because the duplicates still want it.
  const { suggestion } = useSuggestions(workspaceId, title);

  if (chosen !== null) {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-muted">
        Filing as <PriorityBadge priority={chosen} />
        <button
          type="button"
          onClick={() => onChoose(null)}
          className="rounded px-1.5 py-0.5 text-faint transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
        >
          Clear
        </button>
      </p>
    );
  }

  if (suggestion === null) return null;

  if (suggestion.priority === null) {
    return (
      <p aria-live="polite" className="mt-2 text-xs text-faint">
        Priority suggestions start once {suggestion.needed} issues have a priority. This workspace
        has {suggestion.trainedOn}.
      </p>
    );
  }

  const { priority, score } = suggestion;

  return (
    <p aria-live="polite" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
      Reads like <PriorityBadge priority={priority} />
      {/* The score is shown so a weak suggestion looks weak. It is a ranking
          signal from an uncalibrated model, not a probability to trust. */}
      <span className="font-mono text-[10px] text-faint">{Math.round(score * 100)}%</span>
      <button
        type="button"
        onClick={() => onChoose(priority)}
        className="rounded-md border border-line px-2 py-0.5 text-content transition-colors hover:border-accent-soft hover:text-accent-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
      >
        Use
      </button>
    </p>
  );
}
