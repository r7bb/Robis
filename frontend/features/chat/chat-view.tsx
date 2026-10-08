'use client';

import { can, type Role } from '@relay/shared';
import { ApiError } from '../../lib/api.ts';
import { Composer } from './composer.tsx';
import { MessageList } from './message-list.tsx';
import type { ChannelSummary } from './types.ts';
import { flattenMessages, useDeleteMessage, useMessages, useSendMessage } from './use-chat.ts';

/** Turn a thrown value into something worth showing a person. */
function messageFor(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;

  return 'Could not send that message. Check your connection and try again.';
}

/**
 * The centre column: one channel's transcript and its composer.
 *
 * Which channel is selected is decided by the shell above this, so the view
 * can be dropped anywhere a channel id is available and has no opinion about
 * navigation.
 */
export function ChatView({
  workspaceId,
  channel,
  role,
  currentUserId,
}: {
  workspaceId: string;
  channel: ChannelSummary | null;
  role: Role;
  currentUserId: string | null;
}) {
  const channelId = channel?.id ?? null;

  const history = useMessages(workspaceId, channelId);
  const send = useSendMessage(workspaceId, channelId);
  const remove = useDeleteMessage(workspaceId, channelId);

  const messages = flattenMessages(history.data?.pages);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-surface">
      <header className="flex items-baseline gap-3 border-b border-line px-4 py-3">
        <h2 className="truncate text-sm font-semibold text-content">
          <span className="text-faint">#</span>
          {channel?.name ?? 'no channel'}
        </h2>

        {channel?.topic ? <p className="truncate text-xs text-faint">{channel.topic}</p> : null}
      </header>

      {history.isError ? (
        <div className="flex-1 px-4 py-6">
          <p role="alert" className="text-sm text-danger-soft">
            Could not load this conversation.
          </p>
        </div>
      ) : (
        <MessageList
          messages={messages}
          currentUserId={currentUserId}
          canModerate={can(role, 'message:delete_any')}
          onDelete={(messageId) => remove.mutate(messageId)}
          onLoadOlder={() => history.fetchNextPage()}
          hasOlder={Boolean(history.hasNextPage)}
          loadingOlder={history.isFetchingNextPage}
        />
      )}

      <Composer
        channelName={channel?.name ?? ''}
        disabled={!channel || !can(role, 'message:create')}
        sending={send.isPending}
        error={messageFor(send.error)}
        onSend={(body) => send.mutate(body)}
      />
    </section>
  );
}
