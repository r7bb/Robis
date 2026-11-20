'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { call, type Member } from '../../lib/api.ts';
import {
  CELEBRATIONS_SHOWN,
  type Celebration,
  celebrationsKey,
  lineOf,
  readPutAway,
  wellDoneOf,
  writePutAway,
} from './celebrations-model.ts';

/**
 * This week's celebrations (Phase 2c): a project finished, a milestone, an
 * anniversary, a welcome. Worked out from the work, never for anyone who
 * turned them off. "Say well done" starts a post in the composer for you
 * to change or send; nothing is posted for you. Put one away and it stays
 * away, in this browser.
 */
export function Celebrations({
  workspaceId,
  me,
  people,
  onWellDone,
}: {
  workspaceId: string;
  me: string | null;
  people: ReadonlyMap<string, Member>;
  /** Start a post with these words; absent for those who may not post. */
  onWellDone?: (words: string) => void;
}) {
  const query = useQuery({
    queryKey: celebrationsKey(workspaceId),
    queryFn: () => call(contracts['feed.celebrations'], { params: { workspaceId } }),
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const [away, setAway] = useState<Set<string>>(new Set());
  useEffect(() => {
    // Kept with what was put away before `me` was known.
    if (me) setAway((now) => new Set([...readPutAway(me), ...now]));
  }, [me]);

  const live = query.data?.celebrations ?? [];
  // Someone who has since left is not celebrated by a stranger's name.
  const shown = live
    .filter((c) => !away.has(c.id) && (c.userId === null || people.has(c.userId)))
    .slice(0, CELEBRATIONS_SHOWN);
  if (shown.length === 0) return null;

  function putAway(id: string) {
    const next = new Set(away).add(id);
    setAway(next);
    if (me) writePutAway(me, next, live);
    // The button that had focus is gone: focus the list's heading, not the page.
    heading.current?.focus();
  }

  return (
    <section aria-labelledby="celebrations-heading" className="mt-6">
      <h2
        ref={heading}
        id="celebrations-heading"
        tabIndex={-1}
        className="text-sm font-semibold text-content focus:outline-none"
      >
        Worth a well done
      </h2>
      <ul className="mt-2 space-y-2">
        {shown.map((celebration) => (
          <li key={celebration.id}>
            <CelebrationCard
              celebration={celebration}
              person={celebration.userId ? (people.get(celebration.userId) ?? null) : null}
              onWellDone={onWellDone}
              onPutAway={() => putAway(celebration.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CelebrationCard({
  celebration,
  person,
  onWellDone,
  onPutAway,
}: {
  celebration: Celebration;
  person: Member | null;
  onWellDone?: (words: string) => void;
  onPutAway: () => void;
}) {
  const name = person?.name ?? 'Someone';
  const line = lineOf(celebration, name);
  return (
    <article className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised px-4 py-3">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-accent via-accent-soft to-accent"
      />
      {person ? (
        <Avatar name={name} seed={person.userId} avatar={person.avatar ?? null} size="md" />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-sm text-accent-soft"
        >
          ✓
        </span>
      )}
      <p className="min-w-0 flex-1 text-sm leading-snug text-content">
        {line}
        <span className="block text-xs text-faint">{ago(celebration.at)}</span>
      </p>
      {onWellDone ? (
        <button
          type="button"
          onClick={() => onWellDone(wellDoneOf(celebration, name))}
          className="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent-soft transition-[background-color,transform] hover:bg-accent/20 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Say well done
        </button>
      ) : null}
      <button
        type="button"
        onClick={onPutAway}
        aria-label={`Put away: ${line}`}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-faint transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span aria-hidden="true">×</span>
      </button>
    </article>
  );
}
