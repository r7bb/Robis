'use client';

import { contracts, MESSAGE_REACTIONS, type MessageReaction } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { call } from '../../lib/api.ts';
import { MESSAGE_REACTION_FACES } from './chat-place.ts';
import type { ChatMessage } from './types.ts';

/** Adding or taking off a reaction; the room refreshes from the event it sends, and here. */
function useToggleReaction(workspaceId: string, message: ChatMessage) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ reaction, on }: { reaction: MessageReaction; on: boolean }) =>
      call(contracts[on ? 'messages.react' : 'messages.unreact'], {
        params: { workspaceId, messageId: message.id, reaction },
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['messages', workspaceId, message.channelId] }),
  });
}

/** What is on a message, each a toggle for you; nothing at all when there is none. */
export function MessageReactions({
  workspaceId,
  message,
  canReact,
}: {
  workspaceId: string;
  message: ChatMessage;
  canReact: boolean;
}) {
  const toggle = useToggleReaction(workspaceId, message);
  const on = message.reactions ?? [];
  if (on.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {on.map(({ reaction, count, mine }) => (
        <button
          key={reaction}
          type="button"
          aria-pressed={mine}
          disabled={!canReact || toggle.isPending}
          onClick={() => toggle.mutate({ reaction, on: !mine })}
          aria-label={`${MESSAGE_REACTION_FACES[reaction].name}, ${count}`}
          className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors ${
            mine
              ? 'border-accent/60 bg-accent/10 text-content'
              : 'border-line text-muted hover:border-accent/40'
          }`}
        >
          <span aria-hidden="true">{MESSAGE_REACTION_FACES[reaction].glyph}</span>
          <span className="tabular-nums">{count}</span>
        </button>
      ))}
    </div>
  );
}

/** React, in a message's toolbar: six quick choices, closed by a choice, Escape or a click away. */
export function ReactPicker({
  workspaceId,
  message,
}: {
  workspaceId: string;
  message: ChatMessage;
}) {
  const toggle = useToggleReaction(workspaceId, message);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    // Caught on the way down, so the chat panel this sits in does not close too.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', onEscape, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', onEscape, true);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className="rounded px-1.5 py-0.5 text-[10px] text-faint hover:text-content"
      >
        React
      </button>
      {open ? (
        <fieldset className="absolute right-0 top-full z-20 mt-1 flex gap-0.5 rounded-lg border border-line bg-raised p-1 shadow-lg">
          <legend className="sr-only">Add a reaction</legend>
          {MESSAGE_REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type="button"
              onClick={() => {
                setOpen(false);
                toggle.mutate({ reaction, on: true });
              }}
              aria-label={MESSAGE_REACTION_FACES[reaction].name}
              title={MESSAGE_REACTION_FACES[reaction].name}
              className="rounded px-1 text-base hover:bg-surface"
            >
              <span aria-hidden="true">{MESSAGE_REACTION_FACES[reaction].glyph}</span>
            </button>
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}
