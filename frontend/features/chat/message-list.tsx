'use client';

import type { Avatar as AvatarRef } from '@robis/shared';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { Avatar } from '../../components/ui/avatar.tsx';
import { EmptyState } from '../../components/ui/primitives.tsx';
import { BASE_URL } from '../../lib/api.ts';
import { personHref } from '../../lib/links.ts';
import { formatDaySeparator, formatExact, formatTime, isSameDay } from '../../lib/time.ts';
import { StoryRing } from '../stories/story-ring.tsx';
import { MessageBody } from './message-body.tsx';
import type { ChatMessage } from './types.ts';

/**
 * The transcript.
 *
 * Two pieces of grouping do most of the work of making a chat log readable:
 * a date separator when the day changes, and suppressing the avatar and name
 * on consecutive messages from one person. Without them every line carries
 * the same header and the eye has nothing to anchor on.
 */

/** Consecutive messages group only if they are also close in time. */
const GROUP_WINDOW_MS = 5 * 60_000;

function groupsWith(message: ChatMessage, previous: ChatMessage | undefined): boolean {
  if (!previous) return false;
  if (previous.authorId !== message.authorId) return false;
  if (!isSameDay(previous.createdAt, message.createdAt)) return false;

  const gap = new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap < GROUP_WINDOW_MS;
}

export function MessageList({
  workspaceId,
  messages,
  currentUserId,
  avatars,
  canModerate,
  onDelete,
  onLoadOlder,
  hasOlder,
  loadingOlder,
}: {
  workspaceId: string;
  messages: ChatMessage[];
  currentUserId: string | null;
  avatars?: ReadonlyMap<string, AvatarRef>;
  canModerate: boolean;
  onDelete: (messageId: string) => void;
  onLoadOlder: () => void;
  hasOlder: boolean;
  loadingOlder: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const bottomAnchor = useRef<HTMLDivElement>(null);

  /*
   * Follow the conversation, but only if the reader is already at the end.
   *
   * Yanking someone back to the bottom while they are reading history is one
   * of the more irritating things a chat client can do, so the scroll is
   * conditional on them being near it already. The threshold is generous
   * enough to survive the few pixels of drift a new message introduces.
   */
  const lastId = messages.at(-1)?.id;

  // The id of the newest message is the whole trigger. Depending on
  // `messages` instead would re-run on every refetch that returns the same
  // conversation, scrolling the reader down while they are reading up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom > 160) return;

    bottomAnchor.current?.scrollIntoView({ block: 'end' });
  }, [lastId]);

  return (
    // `justify-end` on a `min-h-full` inner column is what anchors a short
    // conversation to the bottom, next to the composer, the way every chat
    // client does it. Without it two messages hang at the top of a tall
    // column with the composer stranded far below them.
    <div ref={scroller} className="flex flex-1 flex-col overflow-y-auto px-4 py-3">
      <div className="flex min-h-full flex-col justify-end">
        {hasOlder ? (
          <div className="mb-3 text-center">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-accent-soft hover:text-content disabled:opacity-50"
            >
              {loadingOlder ? 'Loading…' : 'Load earlier messages'}
            </button>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <div className="pt-8">
            <EmptyState>No messages yet. Say something.</EmptyState>
          </div>
        ) : null}

        <ol className="space-y-0.5">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const grouped = groupsWith(message, previous);
            const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);

            return (
              <li key={message.id}>
                {newDay ? <DaySeparator at={message.createdAt} /> : null}

                <MessageRow
                  workspaceId={workspaceId}
                  message={message}
                  avatar={avatars?.get(message.authorId) ?? null}
                  grouped={grouped}
                  deletable={canModerate || message.authorId === currentUserId}
                  onDelete={() => onDelete(message.id)}
                />
              </li>
            );
          })}
        </ol>

        <div ref={bottomAnchor} />
      </div>
    </div>
  );
}

function DaySeparator({ at }: { at: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="h-px flex-1 bg-line" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
        {formatDaySeparator(at)}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function MessageRow({
  workspaceId,
  message,
  avatar,
  grouped,
  deletable,
  onDelete,
}: {
  workspaceId: string;
  message: ChatMessage;
  avatar: AvatarRef;
  grouped: boolean;
  deletable: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group flex gap-3 rounded-md px-2 hover:bg-surface/60 ${grouped ? 'py-0.5' : 'pt-2 pb-0.5'}`}
    >
      {grouped ? (
        // Keeps the text aligned with the ungrouped rows above it, and shows
        // the time only on hover so the column is not a wall of timestamps.
        <span className="w-8 shrink-0 pt-0.5 text-right text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
          {formatTime(message.createdAt)}
        </span>
      ) : (
        <span className="mt-0.5 inline-flex shrink-0">
          <StoryRing userId={message.authorId} name={message.authorName} inline>
            <Avatar name={message.authorName} seed={message.authorId} avatar={avatar} size="md" />
          </StoryRing>
        </span>
      )}

      <div className="min-w-0 flex-1">
        {grouped ? null : (
          <p className="flex items-baseline gap-2">
            <Link
              href={personHref(workspaceId, message.authorId)}
              className="rounded text-sm font-medium text-content underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              {message.authorName}
            </Link>
            <time
              dateTime={message.createdAt}
              title={formatExact(message.createdAt)}
              className="text-[10px] text-faint"
            >
              {formatTime(message.createdAt)}
            </time>
          </p>
        )}

        {/*
         * Rendered as text, never as markup. Message bodies are the most
         * directly attacker-controlled strings in the product: anything that
         * interpreted them as HTML would be stored XSS against every member
         * of the workspace. `whitespace-pre-wrap` keeps the author's line
         * breaks without parsing anything, and `break-words` stops a pasted
         * URL from widening the column past the viewport.
         */}
        {message.body ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted">
            <MessageBody workspaceId={workspaceId} body={message.body} />
          </p>
        ) : null}
        {message.image ? <MessagePicture image={message.image} by={message.authorName} /> : null}
      </div>

      {deletable ? (
        <button
          type="button"
          onClick={onDelete}
          // Visible on hover for a mouse, and on focus so it is reachable by
          // keyboard -- `opacity-0` alone would make it a silent trap.
          className="self-start rounded px-1.5 py-0.5 text-[10px] text-faint opacity-0 transition-opacity hover:text-danger-soft focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`Delete message from ${message.authorName}`}
        >
          Delete
        </button>
      ) : null}
    </div>
  );
}

/**
 * A picture posted to the room (B2): shown at a size that leaves the
 * conversation readable, opening full size in a new tab. Its width and
 * height are known, so the transcript does not jump as it loads.
 */
function MessagePicture({
  image,
  by,
}: {
  image: { url: string; width: number; height: number };
  by: string;
}) {
  const src = `${BASE_URL}${image.url}`;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-block max-w-full overflow-hidden rounded-lg border border-line bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      {/* biome-ignore lint/performance/noImgElement: members-only bytes with the session cookie */}
      <img
        src={src}
        alt={`Shared by ${by}`}
        width={image.width}
        height={image.height}
        loading="lazy"
        decoding="async"
        className="block h-auto max-h-64 w-auto max-w-full object-contain"
      />
    </a>
  );
}
