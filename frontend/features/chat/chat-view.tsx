'use client';

import type { Avatar as AvatarRef } from '@robis/shared';
import { can, type Role } from '@robis/shared';
import { ApiError } from '../../lib/api.ts';
import { useOnline } from '../../lib/use-online.ts';
import { Summarise } from '../assist/summarise.tsx';
import type { ChatDraft } from '../workspace/chat-controls.tsx';
import { Composer } from './composer.tsx';
import { MessageList } from './message-list.tsx';
import type { ChannelSummary } from './types.ts';
import {
  flattenMessages,
  useDeleteMessage,
  useMessages,
  useSendMessage,
  useSendPicture,
} from './use-chat.ts';
import { useReadPlace } from './use-reads.ts';

/** A channel this busy is worth a summary (D3), where assistance is on. */
const CHANNEL_SUMMARY_FROM = 10;

/** Turn a thrown value into something worth showing a person. */
function messageFor(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;

  return 'Could not send that message. Check your connection and try again.';
}

/**
 * One channel's transcript and its composer, docked under the board.
 *
 * Which channel is selected is decided by the frame above this, so the view
 * can be dropped anywhere a channel id is available and has no opinion about
 * navigation.
 */
export function ChatView({
  workspaceId,
  channel,
  role,
  currentUserId,
  avatars,
  showHeader = true,
  draft = null,
  onDraftUsed,
}: {
  workspaceId: string;
  channel: ChannelSummary | null;
  role: Role;
  currentUserId: string | null;
  /** Each member's picture, by user id, from the roster the frame already holds. */
  avatars?: ReadonlyMap<string, AvatarRef>;
  /** Off in the dock, whose own bar already names the room. */
  showHeader?: boolean;
  /** Text put in the message box from elsewhere (Discuss). */
  draft?: ChatDraft | null;
  onDraftUsed?: () => void;
}) {
  const channelId = channel?.id ?? null;

  const history = useMessages(workspaceId, channelId);
  // Chat is online only (C8): nothing typed here is kept for later.
  const online = useOnline();
  const send = useSendMessage(workspaceId, channelId);
  const picture = useSendPicture(workspaceId, channelId);
  const remove = useDeleteMessage(workspaceId, channelId);

  const messages = flattenMessages(history.data?.pages);
  const newSince = useReadPlace(workspaceId, channelId, messages.at(-1)?.id);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {showHeader ? (
        <header className="flex items-baseline gap-3 border-b border-line px-4 py-3">
          <h2 className="truncate text-sm font-semibold text-content">
            <span className="text-faint">#</span>
            {channel?.name ?? 'no channel'}
          </h2>

          {channel?.topic ? <p className="truncate text-xs text-faint">{channel.topic}</p> : null}
          {channel && messages.length >= CHANNEL_SUMMARY_FROM ? (
            <span className="ml-auto shrink-0">
              <Summarise
                workspaceId={workspaceId}
                kind="channel"
                id={channel.id}
                sourceHref={(source) => `#message-${source}`}
              />
            </span>
          ) : null}
        </header>
      ) : null}

      {history.isError ? (
        <div className="flex-1 px-4 py-6">
          <p role="alert" className="text-sm text-danger-soft">
            Could not load this conversation.
          </p>
        </div>
      ) : (
        <MessageList
          workspaceId={workspaceId}
          messages={messages}
          currentUserId={currentUserId}
          avatars={avatars}
          canModerate={can(role, 'message:delete_any')}
          canReact={can(role, 'message:create')}
          newSince={newSince}
          onDelete={(messageId) => remove.mutate(messageId)}
          onLoadOlder={() => history.fetchNextPage()}
          hasOlder={Boolean(history.hasNextPage)}
          loadingOlder={history.isFetchingNextPage}
        />
      )}

      <Composer
        channelName={channel?.name ?? ''}
        disabled={!channel || !can(role, 'message:create') || !online}
        offline={!online}
        sending={send.isPending}
        error={messageFor(send.error ?? picture.error)}
        onSend={(body) => send.mutate(body)}
        onPicture={(image) => picture.mutate(image)}
        sendingPicture={picture.isPending}
        draft={draft}
        onDraftUsed={onDraftUsed}
      />
    </section>
  );
}
