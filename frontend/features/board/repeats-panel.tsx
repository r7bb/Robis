'use client';

import {
  contracts,
  ISSUE_PRIORITIES,
  type IssuePriority,
  REPEAT_CADENCES,
  REPEAT_MONTH_DAY_MAX,
  type RepeatCadence,
  type ResponseOf,
} from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { call } from '../../lib/api.ts';
import { dateFormat } from '../../lib/i18n/format.ts';

type Repeat = ResponseOf<(typeof contracts)['repeats.list']>['repeats'][number];

const CADENCE_NAMES: Record<RepeatCadence, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
};
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const FIELD =
  'rounded-md border border-line bg-surface px-2 py-1 text-xs text-content outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

/** "Every week on Monday at 09:00". */
function scheduleLine(repeat: Pick<Repeat, 'cadence' | 'weekday' | 'monthDay' | 'hour'>): string {
  const at = `at ${String(repeat.hour).padStart(2, '0')}:00`;
  if (repeat.cadence === 'weekly' && repeat.weekday !== null) {
    return `Every ${WEEKDAYS[repeat.weekday]} ${at}`;
  }
  if (repeat.cadence === 'monthly' && repeat.monthDay !== null) {
    return `Every month on the ${repeat.monthDay}${ordinal(repeat.monthDay)} ${at}`;
  }
  return `${CADENCE_NAMES[repeat.cadence]} ${at}`;
}

/** The viewer's own zone, which needs no naming. */
const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** ", London time", when the repeat keeps a clock other than the viewer's. */
function zoneNote(zone: string): string {
  if (zone === HERE) return '';
  const city = zone.split('/').at(-1)?.replaceAll('_', ' ') ?? zone;
  return `, ${city} time`;
}

/** When it is next filed, read on the repeat's own clock, as its hour is. */
function onItsClock(repeat: Pick<Repeat, 'nextRunAt' | 'timeZone'>): string {
  return dateFormat({
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: repeat.timeZone,
  }).format(new Date(repeat.nextRunAt));
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

/**
 * Repeats on a board: issues filed on a schedule, such as a weekly release
 * check, each at an hour on the clock of whoever set it up. Listed with when
 * each is next filed; paused, resumed or removed by its creator or an admin.
 */
export function RepeatsPanel({
  workspaceId,
  projectId,
  allowed,
}: {
  workspaceId: string;
  projectId: string;
  /** Whether this person may file issues here, and so set up repeats. */
  allowed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const repeats = useQuery({
    queryKey: ['repeats', workspaceId, projectId],
    queryFn: () => call(contracts['repeats.list'], { params: { workspaceId, projectId } }),
    enabled: allowed,
  });
  const list = repeats.data?.repeats ?? [];
  if (!allowed) return null;

  return (
    <div className="mt-2">
      <div className="flex justify-end">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
        >
          Repeats{list.length > 0 ? ` · ${list.length}` : ''}
        </button>
      </div>
      {open ? (
        <section
          aria-label="Repeats"
          className="mt-2 space-y-3 rounded-lg border border-line bg-raised p-3"
        >
          <p className="text-xs text-faint">
            Issues filed here on a schedule, at the hour on your own clock.
          </p>
          {list.length > 0 ? (
            <ul className="divide-y divide-line">
              {list.map((repeat) => (
                <RepeatRow
                  key={repeat.id}
                  workspaceId={workspaceId}
                  projectId={projectId}
                  repeat={repeat}
                />
              ))}
            </ul>
          ) : null}
          <NewRepeat workspaceId={workspaceId} projectId={projectId} />
        </section>
      ) : null}
    </div>
  );
}

function RepeatRow({
  workspaceId,
  projectId,
  repeat,
}: {
  workspaceId: string;
  projectId: string;
  repeat: Repeat;
}) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['repeats', workspaceId, projectId] });
  const pause = useMutation({
    mutationFn: (paused: boolean) =>
      call(contracts['repeats.update'], {
        params: { workspaceId, repeatId: repeat.id },
        body: { paused },
      }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () =>
      call(contracts['repeats.remove'], { params: { workspaceId, repeatId: repeat.id } }),
    onSuccess: refresh,
  });
  const failed = (pause.error ?? remove.error) as Error | null;

  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm text-content">{repeat.title}</span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={pause.isPending}
            onClick={() => pause.mutate(!repeat.paused)}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-content disabled:opacity-50"
          >
            {repeat.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            className="rounded px-1.5 py-0.5 text-[11px] text-faint hover:text-danger-soft disabled:opacity-50"
          >
            Remove
          </button>
        </span>
      </div>
      <p className="text-[11px] text-faint">
        {scheduleLine(repeat)}
        {zoneNote(repeat.timeZone)} · {repeat.paused ? 'paused' : `next ${onItsClock(repeat)}`}
        {' · set up by '}
        {repeat.createdByName}
      </p>
      {failed ? (
        <p role="alert" className="text-xs text-danger-soft">
          {failed.message}
        </p>
      ) : null}
    </li>
  );
}

function NewRepeat({ workspaceId, projectId }: { workspaceId: string; projectId: string }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [cadence, setCadence] = useState<RepeatCadence>('weekly');
  const [weekday, setWeekday] = useState(1);
  const [monthDay, setMonthDay] = useState(1);
  const [hour, setHour] = useState(9);
  const [priority, setPriority] = useState<IssuePriority>('NONE');
  const create = useMutation({
    mutationFn: () =>
      call(contracts['repeats.create'], {
        params: { workspaceId, projectId },
        body: {
          title: title.trim(),
          description: null,
          priority,
          assigneeId: null,
          cadence,
          weekday: cadence === 'weekly' ? weekday : null,
          monthDay: cadence === 'monthly' ? monthDay : null,
          hour,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    onSuccess: () => {
      setTitle('');
      return queryClient.invalidateQueries({ queryKey: ['repeats', workspaceId, projectId] });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim()) create.mutate();
  }

  return (
    <form onSubmit={submit} aria-label="New repeat" className="space-y-2 border-t border-line pt-3">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What to file, like: Weekly release check"
        aria-label="Title"
        maxLength={200}
        className={`${FIELD} w-full text-sm`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="How often"
          value={cadence}
          onChange={(event) => setCadence(event.target.value as RepeatCadence)}
          className={FIELD}
        >
          {REPEAT_CADENCES.map((value) => (
            <option key={value} value={value}>
              {CADENCE_NAMES[value]}
            </option>
          ))}
        </select>
        {cadence === 'weekly' ? (
          <select
            aria-label="Day"
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
            className={FIELD}
          >
            {WEEKDAYS.map((name, index) => (
              <option key={name} value={index}>
                on {name}
              </option>
            ))}
          </select>
        ) : null}
        {cadence === 'monthly' ? (
          <select
            aria-label="Date"
            value={monthDay}
            onChange={(event) => setMonthDay(Number(event.target.value))}
            className={FIELD}
          >
            {Array.from({ length: REPEAT_MONTH_DAY_MAX }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>
                on the {day}
                {ordinal(day)}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label="Hour"
          value={hour}
          onChange={(event) => setHour(Number(event.target.value))}
          className={FIELD}
        >
          {Array.from({ length: 24 }, (_, h) => h).map((h) => (
            <option key={h} value={h}>
              at {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
        <select
          aria-label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as IssuePriority)}
          className={FIELD}
        >
          {ISSUE_PRIORITIES.map((value) => (
            <option key={value} value={value}>
              {value === 'NONE' ? 'No priority' : value.toLowerCase()}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!title.trim() || create.isPending}
          className="ml-auto rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          Add repeat
        </button>
      </div>
      {create.isError ? (
        <p role="alert" className="text-xs text-danger-soft">
          {(create.error as Error).message}
        </p>
      ) : null}
    </form>
  );
}
