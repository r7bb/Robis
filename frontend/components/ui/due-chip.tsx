'use client';

import { type DueTone, describeDue, localToday } from '../../lib/due-date.ts';

const TONES: Record<DueTone, string> = {
  overdue: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
  soon: 'border-amber-400/35 bg-amber-400/10 text-amber-300',
  later: 'border-line text-muted',
  done: 'border-line text-faint',
};

/** When an issue is due (C1), louder as the day nears and once it has passed. */
export function DueChip({ dueOn, finished }: { dueOn: string; finished: boolean }) {
  const { text, tone } = describeDue(dueOn, localToday(), finished);
  return (
    <time
      dateTime={dueOn}
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${TONES[tone]}`}
    >
      {text}
    </time>
  );
}
