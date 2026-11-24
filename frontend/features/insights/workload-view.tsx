'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { call } from '../../lib/api.ts';
import { localToday } from '../../lib/due-date.ts';
import { personHref } from '../../lib/links.ts';

/**
 * Workload: what each person has open here, as a bar against the busiest,
 * with what is overdue, due soon or urgent, and a word where someone is
 * carrying well above the team's typical load. For sharing work out, not
 * for ranking people.
 */
export function WorkloadSection({ workspaceId }: { workspaceId: string }) {
  const load = useQuery({
    queryKey: ['workload', workspaceId],
    queryFn: () =>
      call(contracts['insights.workload'], {
        params: { workspaceId },
        query: { today: localToday() },
      }),
  });
  if (!load.data) return null;
  const { people, medianOpen } = load.data;
  if (people.every((person) => person.open === 0)) return null;
  const most = Math.max(...people.map((person) => person.open), 1);

  return (
    <section aria-labelledby="workload-heading" className="mt-10">
      <h2 id="workload-heading" className="text-sm font-semibold text-content">
        Workload
      </h2>
      <p className="mt-1 text-xs text-faint">
        Open issues each person has here; typically {formatCount(medianOpen)}. For sharing work out,
        not for ranking anyone.
      </p>
      <ul className="mt-3 space-y-2">
        {people.map((person) => (
          <li key={person.userId} className="rounded-lg border border-line bg-raised px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <Link
                href={personHref(workspaceId, person.userId)}
                className="min-w-0 truncate text-sm text-content hover:underline"
              >
                {person.name}
              </Link>
              <span className="shrink-0 text-xs tabular-nums text-muted">
                {person.open} open
                {person.inProgress > 0 ? ` · ${person.inProgress} in progress` : ''}
              </span>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-1.5 rounded-full bg-surface">
              <div
                className={`h-full rounded-full ${person.heavy ? 'bg-amber-400' : 'bg-accent'}`}
                style={{ width: `${(person.open / most) * 100}%` }}
              />
            </div>
            <Notes person={person} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatCount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** What needs a look in someone's load, in words; nothing when nothing does. */
function Notes({
  person,
}: {
  person: { overdue: number; dueSoon: number; urgent: number; heavy: boolean };
}) {
  const said = [
    person.overdue > 0 ? `${person.overdue} overdue` : '',
    person.dueSoon > 0 ? `${person.dueSoon} due this week` : '',
    person.urgent > 0 ? `${person.urgent} urgent` : '',
  ].filter(Boolean);
  if (said.length === 0 && !person.heavy) return null;
  return (
    <p className="mt-1 text-[11px] text-faint">
      {said.join(' · ')}
      {person.heavy ? (
        <span className="text-amber-300">
          {said.length > 0 ? ' · ' : ''}well above the team’s typical load
        </span>
      ) : null}
    </p>
  );
}
