'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Avatar } from '../../components/ui/avatar.tsx';
import { AgentBadge } from '../../components/ui/primitives.tsx';
import { call } from '../../lib/api.ts';
import { discussDraft } from '../../lib/issue-keys.ts';
import { channelHref } from '../../lib/links.ts';
import { formatRelative } from '../../lib/time.ts';
import { useMemberAvatars } from '../../lib/use-member-avatars.ts';
import { useChatControls } from '../workspace/chat-controls.tsx';

const DISCUSSION_KEY = (workspaceId: string, issueId: string) =>
  ['discussion', workspaceId, issueId] as const;

/**
 * Where this issue is talked about in chat: the newest messages naming its
 * key, each with its room, and (beside the chat) a Discuss button that
 * starts one. A message opens its room; on the issue's own page, where there
 * is no chat beside it, that is a link to the workspace with the room open.
 */
export function IssueInChat({
  workspaceId,
  issueId,
  issueKey,
}: {
  workspaceId: string;
  issueId: string;
  issueKey: string;
}) {
  const chat = useChatControls();
  const avatars = useMemberAvatars();
  const discussion = useQuery({
    queryKey: DISCUSSION_KEY(workspaceId, issueId),
    queryFn: () => call(contracts['issues.discussion'], { params: { workspaceId, issueId } }),
  });
  const messages = discussion.data?.messages ?? [];

  return (
    <section className="mt-10" aria-labelledby={`in-chat-${issueId}`}>
      <div className="flex items-center justify-between gap-3">
        <h2
          id={`in-chat-${issueId}`}
          className="text-sm font-medium uppercase tracking-wide text-faint"
        >
          In chat
          {messages.length > 0 && <span className="ml-2 text-faint">{messages.length}</span>}
        </h2>
        {chat ? (
          <button
            type="button"
            onClick={() => chat.discuss(discussDraft(issueKey))}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Discuss
          </button>
        ) : null}
      </div>

      {discussion.isError ? (
        <p className="mt-3 text-sm text-faint">What was said about it could not be loaded.</p>
      ) : discussion.isSuccess && messages.length === 0 ? (
        <p className="mt-3 text-sm text-faint">
          Nobody has named {issueKey} in chat yet.
          {chat ? ' Discuss starts a message about it.' : ''}
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {messages.map((message) => {
            const inner = (
              <>
                <span className="flex items-center gap-2 text-xs text-faint">
                  <Avatar
                    name={message.authorName}
                    seed={message.authorId}
                    avatar={avatars.get(message.authorId) ?? null}
                    size="sm"
                  />
                  <span className="text-muted">{message.authorName}</span>
                  {message.authorKind === 'agent' && <AgentBadge />}
                  <span>in #{message.channelName}</span>
                  <span className="ml-auto shrink-0">{formatRelative(message.createdAt)}</span>
                </span>
                <span className="mt-1 line-clamp-2 block text-sm text-content">{message.body}</span>
              </>
            );
            const tone =
              'block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft';
            return (
              <li key={message.id}>
                {chat ? (
                  <button
                    type="button"
                    onClick={() => chat.openRoom(message.channelId)}
                    className={tone}
                  >
                    {inner}
                  </button>
                ) : (
                  <Link href={channelHref(workspaceId, message.channelId)} className={tone}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
