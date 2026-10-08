'use client';

import { CHANNEL_NAME_MAX_LENGTH } from '@relay/shared/limits';
import { type FormEvent, useState } from 'react';
import { Button, InlineError, SectionLabel } from '../../components/ui/primitives.tsx';

/**
 * The room switcher.
 *
 * Shows the raw name prefixed with `#` rather than a title-cased version: the
 * server normalises names to lowercase and hyphens, and displaying something
 * other than what is stored makes "already taken" errors confusing.
 */
export function ChannelList({
  channels,
  activeId,
  onSelect,
  canCreate,
  creating,
  createError,
  onCreate,
}: {
  channels: { id: string; name: string; topic: string | null }[];
  activeId: string | null;
  onSelect: (channelId: string) => void;
  canCreate: boolean;
  creating: boolean;
  createError: string | null;
  onCreate: (name: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();

    const trimmed = name.trim();
    if (!trimmed || creating) return;

    onCreate(trimmed);
    setName('');
  }

  return (
    <section className="space-y-2">
      <SectionLabel
        action={
          canCreate ? (
            <button
              type="button"
              onClick={() => setAdding((open) => !open)}
              className="rounded px-1 text-sm leading-none text-faint transition-colors hover:text-content"
              aria-expanded={adding}
              aria-label={adding ? 'Cancel new channel' : 'New channel'}
            >
              {adding ? '×' : '+'}
            </button>
          ) : null
        }
      >
        Channels
      </SectionLabel>

      {adding ? (
        <form onSubmit={submit} className="space-y-1.5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={CHANNEL_NAME_MAX_LENGTH}
            placeholder="design-review"
            aria-label="New channel name"
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-content placeholder:text-faint focus:border-accent-soft focus:outline-none"
          />

          <Button type="submit" size="sm" variant="primary" disabled={creating} className="w-full">
            {creating ? 'Creating…' : 'Create channel'}
          </Button>

          {createError ? <InlineError>{createError}</InlineError> : null}
        </form>
      ) : null}

      <ul className="space-y-px">
        {channels.map((channel) => {
          const active = channel.id === activeId;

          return (
            <li key={channel.id}>
              <button
                type="button"
                onClick={() => onSelect(channel.id)}
                // `aria-current` rather than only a colour change, so the
                // selected room is announced and not merely seen.
                aria-current={active ? 'true' : undefined}
                title={channel.topic ?? undefined}
                className={`flex w-full items-baseline gap-1 truncate rounded px-2 py-1 text-left text-sm transition-colors ${
                  active
                    ? 'bg-accent/15 font-medium text-accent-soft'
                    : 'text-muted hover:bg-raised hover:text-content'
                }`}
              >
                <span className="text-faint">#</span>
                <span className="truncate">{channel.name}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {channels.length === 0 && !adding ? (
        <p className="px-2 text-xs text-faint">No channels yet.</p>
      ) : null}
    </section>
  );
}
