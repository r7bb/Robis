'use client';

import type { Avatar as AvatarRef, Role } from '@robis/shared';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react';
import { Kbd } from '../../components/ui/kbd.tsx';
import { ChatView } from '../chat/chat-view.tsx';
import type { ChannelSummary } from '../chat/types.ts';
import { DOCK_MIN_HEIGHT, DOCK_STEP, isDockShortcut, useDock } from './use-dock.ts';

/**
 * Chat, docked under the board like a code editor's terminal: a bar with
 * the rooms that is always there, and above it, when open, the open room's
 * conversation. Its height is dragged from the top edge (or set with the
 * arrow keys there), and Ctrl ` opens and closes it from anywhere.
 */
export function ChatDock({
  workspaceId,
  rooms,
  channel,
  onSelect,
  role,
  currentUserId,
  avatars,
  openWhen,
}: {
  workspaceId: string;
  rooms: ChannelSummary[];
  channel: ChannelSummary | null;
  onSelect: (id: string) => void;
  role: Role;
  currentUserId: string | null;
  avatars: ReadonlyMap<string, AvatarRef>;
  /** Changes when a room is asked for from elsewhere (the palette), to open the dock. */
  openWhen: string | null;
}) {
  const dock = useDock();
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const { setOpen, open } = dock;

  // Asked for a room: show it.
  useEffect(() => {
    if (openWhen) setOpen(true);
  }, [openWhen, setOpen]);

  // Ctrl `: open and put the cursor in the message box, or close.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!isDockShortcut(event) || event.defaultPrevented) return;
      event.preventDefault();
      if (open) {
        setOpen(false);
        // The message box goes with the dock; focus stays on its button.
        requestAnimationFrame(() => toggle.current?.focus());
        return;
      }
      setOpen(true);
      requestAnimationFrame(() => panel.current?.querySelector('textarea')?.focus());
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  /** Drag the top edge: the dock is as tall as the distance to the window's foot. */
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const bottom = handle.parentElement?.getBoundingClientRect().bottom ?? window.innerHeight;
    const move = (moved: globalThis.PointerEvent) => dock.setHeight(bottom - moved.clientY);
    // Ended however it ends: let go, interrupted, or capture lost.
    const ends = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;
    const up = () => {
      handle.removeEventListener('pointermove', move);
      for (const end of ends) handle.removeEventListener(end, up);
    };
    handle.addEventListener('pointermove', move);
    for (const end of ends) handle.addEventListener(end, up);
  }

  function onHandleKey(event: KeyboardEvent<HTMLDivElement>) {
    const to: Record<string, number> = {
      ArrowUp: dock.height + DOCK_STEP,
      ArrowDown: dock.height - DOCK_STEP,
      Home: DOCK_MIN_HEIGHT,
      End: dock.maxHeight,
    };
    const next = to[event.key];
    if (next === undefined) return;
    event.preventDefault();
    dock.setHeight(next);
  }

  return (
    <section
      aria-label="Chat"
      className="relative flex shrink-0 flex-col border-t border-line bg-raised"
      style={open ? { height: dock.height } : undefined}
    >
      {open && (
        // biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no element of its own
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Chat height"
          aria-valuenow={dock.height}
          aria-valuemin={DOCK_MIN_HEIGHT}
          aria-valuemax={dock.maxHeight}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onKeyDown={onHandleKey}
          className="absolute inset-x-0 -top-1.5 z-10 h-3 cursor-row-resize touch-none outline-none transition-colors hover:bg-accent/30 focus-visible:bg-accent/40"
        />
      )}

      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Chat</span>
        <nav aria-label="Rooms" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {rooms.map((room) => {
            const active = room.id === channel?.id;
            return (
              <button
                key={room.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSelect(room.id);
                  setOpen(true);
                }}
                className={`shrink-0 rounded px-2 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                  active && open
                    ? 'bg-accent/15 text-content'
                    : 'text-faint hover:bg-surface hover:text-muted'
                }`}
              >
                <span aria-hidden="true">#</span>
                {room.name}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          ref={toggle}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls="chat-dock-panel"
          className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          {open ? 'Hide' : 'Show'}
          <span className="hidden sm:inline-flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>`</Kbd>
          </span>
        </button>
      </div>

      {open && (
        <div ref={panel} id="chat-dock-panel" className="flex min-h-0 flex-1">
          <ChatView
            workspaceId={workspaceId}
            channel={channel}
            role={role}
            currentUserId={currentUserId}
            avatars={avatars}
            showHeader={false}
          />
        </div>
      )}
    </section>
  );
}
