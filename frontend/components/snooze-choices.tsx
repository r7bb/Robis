'use client';

import { parseWhen, SNOOZE_PRESETS } from '@robis/shared';
import { type FormEvent, useId, useState } from 'react';
import { dateFormat } from '../lib/i18n/format.ts';

/** "Fri 27 Nov, 09:00", in the reader's own words for dates. */
export function formatWhen(when: Date | string): string {
  return dateFormat({
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(when));
}

/**
 * When to bring something back: three choices, or a time in plain words
 * ("in 2 hours", "friday 3pm"), read back before it is set so nobody
 * snoozes to a moment they did not mean.
 */
export function SnoozeChoices({
  onChoose,
  onCancel,
  pending,
  action = 'Snooze',
  framed = true,
}: {
  onChoose: (until: Date) => void;
  onCancel: () => void;
  pending: boolean;
  /** What the button says: Snooze in the inbox, Remind me elsewhere. */
  action?: string;
  /** With its own band, as under an inbox entry; bare inside a popover. */
  framed?: boolean;
}) {
  const [typed, setTyped] = useState('');
  const fieldId = useId();
  const now = new Date();
  const parsed = typed.trim() ? parseWhen(typed, now) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (parsed) onChoose(parsed);
  }

  return (
    <div className={framed ? 'space-y-2 border-t border-line bg-surface px-4 py-3' : 'space-y-2'}>
      <div className="flex flex-wrap gap-1.5">
        {SNOOZE_PRESETS.map((preset) => {
          const at = preset.at(now);
          return (
            <button
              key={preset.label}
              type="button"
              disabled={pending}
              onClick={() => onChoose(at)}
              title={formatWhen(at)}
              className="rounded-md border border-line px-2 py-1 text-xs text-muted transition-colors hover:border-accent/60 hover:text-content disabled:opacity-50"
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <form onSubmit={submit} className="flex items-center gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Or type when
        </label>
        <input
          id={fieldId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              // The inbox closes on Escape; here it closes only this.
              event.stopPropagation();
              onCancel();
            }
          }}
          placeholder="Or type: friday 3pm"
          autoComplete="off"
          maxLength={40}
          aria-describedby={`${fieldId}-reads`}
          className="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 text-xs text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <button
          type="submit"
          disabled={!parsed || pending}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
        >
          {action}
        </button>
      </form>
      <p id={`${fieldId}-reads`} aria-live="polite" className="text-[11px] text-faint">
        {typed.trim()
          ? parsed
            ? `${action === 'Snooze' ? 'Back' : 'At'} ${formatWhen(parsed)}`
            : 'Not a time ahead yet. Try “tomorrow 9am” or “in 3 days”.'
          : ''}
      </p>
    </div>
  );
}
