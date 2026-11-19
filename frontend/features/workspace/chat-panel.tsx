'use client';

import type { Avatar as AvatarRef, Role } from '@robis/shared';
import { can } from '@robis/shared';
import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import { Kbd } from '../../components/ui/kbd.tsx';
import { ApiError, type Member } from '../../lib/api.ts';
import { useOverlay } from '../../lib/use-overlay.ts';
import { ChatView } from '../chat/chat-view.tsx';
import { PeopleStack } from '../chat/people-stack.tsx';
import { RoomPicker } from '../chat/room-picker.tsx';
import type { ChannelSummary } from '../chat/types.ts';
import { useCreateChannel } from '../chat/use-chat.ts';
import { CHAT_MIN_WIDTH, CHAT_STEP, isChatShortcut, type useChatPanel } from './use-chat-panel.ts';

type Panel = ReturnType<typeof useChatPanel>;

/** The top bar's way back in, once the chat is shut. */
const chatToggle = () => document.querySelector<HTMLElement>('[data-chat-toggle]');

/** Shut the chat and leave focus on the way back, not lost at the top of the page. */
function closeChat(panel: Panel) {
  panel.setOpen(false);
  requestAnimationFrame(() => chatToggle()?.focus());
}

/** Ctrl `: open with the cursor in the message box, or close. */
function useChatShortcut(panel: Panel, body: RefObject<HTMLDivElement | null>) {
  const latest = useRef(panel);
  latest.current = panel;
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!isChatShortcut(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (latest.current.open) return closeChat(latest.current);
      latest.current.setOpen(true);
      requestAnimationFrame(() => body.current?.querySelector('textarea')?.focus());
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [body]);
}

/** The left edge, dragged or moved with the arrow, Home and End keys, sets the width. */
function ResizeEdge({ panel }: { panel: Panel }) {
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const right = handle.parentElement?.getBoundingClientRect().right ?? window.innerWidth;
    const move = (moved: globalThis.PointerEvent) => panel.setWidth(right - moved.clientX);
    // Ended however it ends: let go, interrupted, or capture lost.
    const ends = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;
    const up = () => {
      handle.removeEventListener('pointermove', move);
      for (const end of ends) handle.removeEventListener(end, up);
    };
    handle.addEventListener('pointermove', move);
    for (const end of ends) handle.addEventListener(end, up);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const to: Record<string, number> = {
      ArrowLeft: panel.width + CHAT_STEP,
      ArrowRight: panel.width - CHAT_STEP,
      Home: CHAT_MIN_WIDTH,
      End: panel.maxWidth,
    };
    const next = to[event.key];
    if (next === undefined) return;
    event.preventDefault();
    panel.setWidth(next);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no element of its own
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Chat width"
      aria-valuenow={panel.width}
      aria-valuemin={CHAT_MIN_WIDTH}
      aria-valuemax={panel.maxWidth}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none transition-colors hover:bg-accent/20 focus-visible:bg-accent/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-soft"
    />
  );
}

/**
 * Chat, on the right: the open room (chosen at its top, the one place
 * rooms are listed), the people in the workspace, and the conversation.
 * Beside the board on a wide screen, over it on a narrow one. Ctrl `
 * opens and closes it from anywhere.
 */
export function ChatPanel({
  workspaceId,
  panel,
  rooms,
  channel,
  onSelect,
  role,
  currentUserId,
  avatars,
  members,
  onlineIds,
}: {
  workspaceId: string;
  panel: Panel;
  rooms: ChannelSummary[];
  channel: ChannelSummary | null;
  onSelect: (id: string) => void;
  role: Role;
  currentUserId: string | null;
  avatars: ReadonlyMap<string, AvatarRef>;
  members: Member[];
  onlineIds: Set<string>;
}) {
  const body = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);
  const createRoom = useCreateChannel(workspaceId);
  useChatShortcut(panel, body);
  useOverlay({
    active: panel.open && panel.overlay,
    onClose: () => panel.setOpen(false),
    panel: aside,
    returnFocus: chatToggle,
  });

  // Until the saved state is read, a wide screen keeps the panel's room, so
  // the board does not jump sideways when it arrives.
  if (!panel.ready) {
    return (
      <div
        aria-hidden="true"
        style={{ width: panel.width }}
        className="hidden shrink-0 border-l border-line bg-raised lg:block"
      />
    );
  }
  if (!panel.open) return null;

  const content = (
    <aside
      ref={aside}
      aria-label="Chat"
      {...(panel.overlay ? { role: 'dialog', 'aria-modal': true } : {})}
      style={panel.overlay ? undefined : { width: panel.width }}
      className={`flex shrink-0 flex-col border-l border-line bg-raised ${
        panel.overlay
          ? 'fixed inset-y-0 right-0 z-30 w-full max-w-md overscroll-contain pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl shadow-black/30'
          : 'relative'
      }`}
    >
      {panel.overlay ? null : <ResizeEdge panel={panel} />}

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
        <RoomPicker
          rooms={rooms}
          active={channel}
          onSelect={onSelect}
          canCreate={can(role, 'channel:create')}
          creating={createRoom.isPending}
          createError={createRoom.error instanceof ApiError ? createRoom.error.message : null}
          onCreate={async (name) => {
            const made = await createRoom.mutateAsync(name);
            onSelect(made.channel.id);
          }}
        />
        <span className="flex-1" />
        <PeopleStack workspaceId={workspaceId} members={members} onlineIds={onlineIds} />
        <button
          type="button"
          onClick={() => closeChat(panel)}
          aria-label="Hide chat"
          title="Hide chat (Ctrl `)"
          className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          <span className="hidden xl:inline-flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>`</Kbd>
          </span>
          <span aria-hidden="true" className="px-0.5 text-sm leading-none">
            ×
          </span>
        </button>
      </header>

      {channel?.topic ? (
        <p className="truncate border-b border-line px-4 py-1.5 text-xs text-faint">
          {channel.topic}
        </p>
      ) : null}

      <div ref={body} className="flex min-h-0 flex-1">
        <ChatView
          workspaceId={workspaceId}
          channel={channel}
          role={role}
          currentUserId={currentUserId}
          avatars={avatars}
          showHeader={false}
        />
      </div>
    </aside>
  );

  if (!panel.overlay) return content;
  return (
    <>
      <button
        type="button"
        aria-label="Close chat"
        onClick={() => panel.setOpen(false)}
        className="fixed inset-0 z-20 bg-black/40"
        tabIndex={-1}
      />
      {content}
    </>
  );
}
