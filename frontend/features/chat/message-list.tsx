'use client';

import type { Avatar as AvatarRef } from '@robis/shared';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { EmptyView } from '../../components/empty-view.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { BASE_URL } from '../../lib/api.ts';
import { personHref } from '../../lib/links.ts';
import { formatDaySeparator, formatExact, formatTime, isSameDay } from '../../lib/time.ts';
import { useScrollToHash } from '../../lib/use-scroll-to-hash.ts';
import { IssueFromMessage } from '../assist/issue-from-message.tsx';
import { RemindMe } from '../reminders/remind-me.tsx';
import { StoryRing } from '../stories/story-ring.tsx';
import { firstUnread } from './chat-place.ts';
import { MessageBody } from './message-body.tsx';
import { MessageReactions, ReactPicker } from './message-reactions.tsx';
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
  canReact,
  newSince,
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
  canReact: boolean;
  /** How far the reader had read on opening the room; null when nothing was new. */
  newSince: string | null;
  onDelete: (messageId: string) => void;
  onLoadOlder: () => void;
  hasOlder: boolean;
  loadingOlder: boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const firstNewId = firstUnread(messages, newSince, currentUserId);
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

  // A link to one message (from search) opens at it.
  useScrollToHash(messages.length > 0);

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
            <EmptyView view="messages" />
          </div>
        ) : null}

        <ol className="space-y-0.5">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const grouped = groupsWith(message, previous);
            const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);

            return (
              <li key={message.id} id={`message-${message.id}`} className="scroll-mt-16">
                {newDay ? <DaySeparator at={message.createdAt} /> : null}
                {message.id === firstNewId ? <NewSeparator /> : null}

                <MessageRow
                  workspaceId={workspaceId}
                  message={message}
                  avatar={avatars?.get(message.authorId) ?? null}
                  grouped={grouped}
                  deletable={canModerate || message.authorId === currentUserId}
                  canReact={canReact}
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

/** Where what you had not read begins. */
function NewSeparator() {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="h-px flex-1 bg-accent/50" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-soft">
        New<span className="sr-only"> messages from here</span>
      </span>
      <span className="h-px flex-1 bg-accent/50" />
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
  canReact,
  onDelete,
}: {
  workspaceId: string;
  message: ChatMessage;
  avatar: AvatarRef;
  grouped: boolean;
  deletable: boolean;
  canReact: boolean;
  onDelete: () => void;
}) {
  return (
    <div
      className={`group relative flex flex-wrap gap-3 rounded-md px-2 hover:bg-surface/60 focus-within:bg-surface/60 ${grouped ? 'py-0.5' : 'pt-2 pb-0.5'}`}
    >
      {grouped ? (
        // Keeps the text aligned with the ungrouped rows above it, and shows
        // the time only on hover so the column is not a wall of timestamps.
        <span className="w-8 shrink-0 pt-0.5 text-right text-[10px] text-faint opacity-0 transition-opacity group-hover:opacity-100">
          {formatTime(message.createdAt)}
        </span>
      ) : (
        <span className="mt-0.5 inline-flex shrink-0 items-start self-start">
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
        <MessageReactions workspaceId={workspaceId} message={message} canReact={canReact} />
      </div>

      {message.body ? <IssueFromMessage workspaceId={workspaceId} messageId={message.id} /> : null}
      {/* Floats over the row's corner rather than taking its width, shown on
          hover for a mouse and on focus for a keyboard, so it is never a
          silent trap. */}
      <div className="absolute right-1 top-0 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-md border border-line bg-raised px-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {canReact ? <ReactPicker workspaceId={workspaceId} message={message} /> : null}
        <RemindMe workspaceId={workspaceId} about="message" id={message.id} subtle />
        {deletable ? (
          <button
            type="button"
            onClick={onDelete}
            className="rounded px-1.5 py-0.5 text-[10px] text-faint hover:text-danger-soft"
            aria-label={`Delete message from ${message.authorName}`}
          >
            Delete
          </button>
        ) : null}
      </div>
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
