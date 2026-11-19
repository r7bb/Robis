'use client';

import { CHANNEL_NAME_MAX_LENGTH } from '@robis/shared/limits';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { InlineError } from '../../components/ui/primitives.tsx';
import type { ChannelSummary } from './types.ts';

/**
 * The one place rooms are chosen and made: the open room's name at the top
 * of the chat, which opens a short list of the others and a field for a
 * new one. Escape or a click elsewhere closes it, and focus goes back to
 * the name.
 */
export function RoomPicker({
  rooms,
  active,
  onSelect,
  canCreate,
  creating,
  createError,
  onCreate,
}: {
  rooms: ChannelSummary[];
  active: ChannelSummary | null;
  onSelect: (id: string) => void;
  canCreate: boolean;
  creating: boolean;
  createError: string | null;
  /** Resolves once made; a refusal keeps the list open with its reason. */
  onCreate: (name: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    // Caught on the way down, so a panel this sits in does not close too.
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    try {
      await onCreate(trimmed);
      setName('');
      close();
    } catch {
      // The reason shows below the field; the list stays open to fix it.
    }
  }

  return (
    <div ref={box} className="relative min-w-0">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Room: ${active?.name ?? 'none'}. Change room`}
        onClick={() => setOpen((was) => !was)}
        className="flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold text-content transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        <span aria-hidden="true" className="text-faint">
          #
        </span>
        <span className="truncate">{active?.name ?? 'No room'}</span>
        <span aria-hidden="true" className="text-xs text-faint">
          ▾
        </span>
      </button>

      {open && (
        <div
          id={listId}
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-line bg-raised p-1.5 shadow-lg shadow-black/20"
        >
          <ul className="max-h-64 space-y-px overflow-y-auto overscroll-contain">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  aria-current={room.id === active?.id ? 'true' : undefined}
                  onClick={() => {
                    onSelect(room.id);
                    close();
                  }}
                  className={`flex w-full items-baseline gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                    room.id === active?.id
                      ? 'bg-accent/15 text-content'
                      : 'text-muted hover:bg-surface hover:text-content'
                  }`}
                >
                  <span aria-hidden="true" className="text-faint">
                    #
                  </span>
                  <span className="max-w-[70%] shrink-0 truncate">{room.name}</span>
                  {room.topic ? (
                    <span className="ml-auto min-w-0 truncate pl-3 text-xs text-faint">
                      {room.topic}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {rooms.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-faint">No rooms yet.</p>
          ) : null}

          {canCreate ? (
            <form onSubmit={submit} className="mt-1.5 border-t border-line pt-1.5">
              <label className="sr-only" htmlFor={`${listId}-new`}>
                New room name
              </label>
              <input
                id={`${listId}-new`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={CHANNEL_NAME_MAX_LENGTH}
                name="room"
                autoComplete="off"
                placeholder="New room, then Enter…"
                className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none"
              />
            </form>
          ) : null}
          <div aria-live="polite">
            {createError ? <InlineError>{createError}</InlineError> : null}
          </div>
        </div>
      )}
    </div>
  );
}
