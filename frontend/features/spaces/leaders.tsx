'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Avatar } from '../../components/ui/avatar.tsx';
import { call, type Member } from '../../lib/api.ts';
import { threadHref } from '../../lib/links.ts';
import { type LeaderPeriod, leaderLine, leadersKey, PERIODS } from './spaces-model.ts';

/**
 * The most helpful, this week, this month or of all time: people by the
 * Helpful marks their replies received (marking your own counts for
 * nothing), then the replies that helped most.
 */

const MEDALS = ['bg-amber-400', 'bg-zinc-300', 'bg-orange-400'] as const;

function Rank({ place }: { place: number }) {
  const medal = MEDALS[place];
  if (!medal) {
    return <span className="w-5 text-center text-xs tabular-nums text-faint">{place + 1}</span>;
  }
  return (
    <span
      className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold text-zinc-900 ${medal}`}
    >
      {place + 1}
    </span>
  );
}

export function MostHelpful({
  workspaceId,
  people,
  compact = false,
}: {
  workspaceId: string;
  people: ReadonlyMap<string, Member>;
  /** Fewer rows and no replies, for beside the feed. */
  compact?: boolean;
}) {
  const [period, setPeriod] = useState<LeaderPeriod>('month');
  const leaders = useQuery({
    queryKey: leadersKey(workspaceId, period),
    queryFn: () =>
      call(contracts['spaces.leaders'], { params: { workspaceId }, query: { period } }),
  });
  const ranked = (leaders.data?.people ?? []).slice(0, compact ? 3 : 10);
  const replies = compact ? [] : (leaders.data?.replies ?? []);

  return (
    <section
      aria-labelledby="most-helpful-heading"
      className="rounded-xl border border-line bg-raised p-4 shadow-sm"
    >
      <div className="space-y-2">
        <h2 id="most-helpful-heading" className="text-sm font-semibold text-content">
          Most helpful
        </h2>
        <fieldset className="grid grid-cols-3 rounded-lg bg-surface p-0.5 text-[11px]">
          <legend className="sr-only">Over</legend>
          {(Object.keys(PERIODS) as LeaderPeriod[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={period === id}
              onClick={() => setPeriod(id)}
              className={`whitespace-nowrap rounded-md px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${period === id ? 'bg-raised font-medium text-content shadow-sm' : 'text-muted hover:text-content'}`}
            >
              {PERIODS[id]}
            </button>
          ))}
        </fieldset>
      </div>

      {leaders.isPending ? (
        <ul className="mt-3 space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="h-8 animate-pulse rounded-md bg-surface" />
          ))}
        </ul>
      ) : ranked.length === 0 ? (
        <p className="mt-3 text-xs text-faint">
          Nobody yet. Mark a reply Helpful and the person who wrote it shows here.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {ranked.map((leader, place) => {
            const person = people.get(leader.userId);
            return (
              <li key={leader.userId} className="flex items-center gap-2.5">
                <Rank place={place} />
                <Avatar
                  name={person?.name ?? 'Someone'}
                  seed={leader.userId}
                  avatar={person?.avatar ?? null}
                  size="sm"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-content">
                  {person?.name ?? 'Someone'}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {leaderLine(leader.helpful, leader.answers)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {replies.length > 0 ? (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-faint">
            Replies that helped most
          </h3>
          <ul className="mt-2 space-y-2">
            {replies.map((top) => (
              <li key={top.replyId}>
                <Link
                  href={`${threadHref(workspaceId, top.threadId)}#reply-${top.replyId}`}
                  className="block rounded-lg border border-line bg-surface p-2.5 transition-colors hover:border-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                >
                  <p className="line-clamp-2 text-xs text-content">{top.excerpt}</p>
                  <p className="mt-1 truncate text-[11px] text-faint">
                    {people.get(top.authorId)?.name ?? 'Someone'} in {top.spaceName} · {top.helpful}{' '}
                    helpful{top.answer ? ' · the answer' : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
