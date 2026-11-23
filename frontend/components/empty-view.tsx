'use client';

import Link from 'next/link';
import { EMPTY_VIEWS, type EmptyViewKey, guideHref } from '../lib/empty-views.ts';
import { Button } from './ui/primitives.tsx';

/**
 * An empty list that says what goes in it and offers the one thing that
 * fills it (C5), with the copy from `EMPTY_VIEWS`. `canFill` is false for
 * someone whose role cannot add here, who sees the explanation and no
 * button. `compact` is the narrow form for the left rail.
 *
 * Only for a list that is legitimately empty, never one that failed to
 * load: the difference decides whether the reader should retry or start.
 */

/** Moves to a field already on the page, bringing it into view. */
function focusField(selector: string) {
  const field = document.querySelector<HTMLElement>(selector);
  if (!field) return;
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  field.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
  field.focus({ preventScroll: true });
}

const LINK =
  'rounded text-xs text-muted underline-offset-2 hover:text-content hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';

function Action({
  view,
  workspaceId,
  compact,
}: {
  view: EmptyViewKey;
  workspaceId?: string;
  compact: boolean;
}) {
  const { action, guide } = EMPTY_VIEWS[view];
  if (!action) return null;
  if ('href' in action) {
    const href =
      action.href === 'first-run' ? '/first-run' : guide ? guideHref(guide, workspaceId) : '/';
    return (
      <Link
        href={href}
        className={
          compact
            ? LINK
            : 'inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft active:scale-[0.98]'
        }
      >
        {action.label}
      </Link>
    );
  }
  return compact ? (
    <button type="button" onClick={() => focusField(action.focus)} className={LINK}>
      {action.label}
    </button>
  ) : (
    <Button variant="primary" onClick={() => focusField(action.focus)}>
      {action.label}
    </Button>
  );
}

export function EmptyView({
  view,
  workspaceId,
  canFill = true,
  compact = false,
}: {
  view: EmptyViewKey;
  workspaceId?: string;
  canFill?: boolean;
  compact?: boolean;
}) {
  const { title, body, guide, action } = EMPTY_VIEWS[view];
  // The guide link, unless the action already goes to the guide.
  const guideLink =
    guide && !(action && 'href' in action && action.href === 'guide')
      ? guideHref(guide, workspaceId)
      : null;

  if (compact) {
    return (
      <div className="px-2 text-xs text-faint" data-empty={view}>
        <p>{title}.</p>
        {canFill ? <Action view={view} workspaceId={workspaceId} compact /> : null}
      </div>
    );
  }

  return (
    <div
      data-empty={view}
      className="rounded-xl border border-dashed border-line px-5 py-7 text-center"
    >
      <p className="text-sm font-medium text-content">{title}</p>
      <p className="mx-auto mt-1 max-w-[46ch] text-sm leading-relaxed text-muted">{body}</p>
      {canFill && action ? (
        <div className="mt-4 flex items-center justify-center gap-4">
          <Action view={view} workspaceId={workspaceId} compact={false} />
          {guideLink ? (
            <Link href={guideLink} className={LINK}>
              How it works
            </Link>
          ) : null}
        </div>
      ) : guideLink ? (
        <Link href={guideLink} className={`${LINK} mt-3 inline-block`}>
          How it works
        </Link>
      ) : null}
    </div>
  );
}
