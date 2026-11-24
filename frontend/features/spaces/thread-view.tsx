'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { call, type Member } from '../../lib/api.ts';
import { spaceHref, spacesHref } from '../../lib/links.ts';
import { useMyId, usePeople } from '../../lib/use-people.ts';
import type { Reaction } from '../feed/feed-model.ts';
import { ReactionBar } from '../feed/reaction-bar.tsx';
import { useWorkspaceRole } from '../workspace/page-frame.tsx';
import { ReplyBox, ReplyList, type TreeContext } from './reply-tree.tsx';
import { KindChip, SolvedChip } from './space-view.tsx';
import {
  nestReplies,
  type Reply,
  repliesLine,
  spacesKey,
  type ThreadPage,
  threadKey,
} from './spaces-model.ts';

/**
 * A thread: what was asked or shared, the reply marked as the answer
 * lifted to the top, then every reply as a tree.
 */

type Thread = ThreadPage['thread'];

function ThreadArticle({
  workspaceId,
  thread,
  people,
  me,
  mayRemove,
}: {
  workspaceId: string;
  thread: Thread;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  mayRemove: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const react = useMutation({
    mutationFn: ({ reaction, on }: { reaction: Reaction; on: boolean }) =>
      call(contracts[on ? 'spaces.react' : 'spaces.unreact'], {
        params: { workspaceId, targetId: thread.id, reaction },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(workspaceId, thread.id) }),
  });
  const remove = useMutation({
    mutationFn: () =>
      call(contracts['spaces.deleteThread'], { params: { workspaceId, threadId: thread.id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: spacesKey(workspaceId) });
      router.push(spaceHref(workspaceId, thread.spaceId));
    },
  });
  const author = people.get(thread.authorId);
  return (
    <article className="mt-3 rounded-2xl border border-line bg-raised p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <KindChip kind={thread.kind} />
        {thread.solved ? <SolvedChip /> : null}
      </div>
      <h1 className="mt-2 text-pretty text-xl font-semibold tracking-tight text-content">
        {thread.title}
      </h1>
      <div className="mt-2 flex items-center gap-2 text-xs text-faint">
        <Avatar
          name={author?.name ?? 'Someone'}
          seed={thread.authorId}
          avatar={author?.avatar ?? null}
          size="sm"
        />
        <span>
          {author?.name ?? 'Someone'} · {ago(thread.createdAt)} · {repliesLine(thread.replyCount)}
        </span>
      </div>
      {thread.body ? (
        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-content">
          {thread.body}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ReactionBar
          reactions={thread.reactions}
          people={people}
          me={me}
          pending={react.isPending}
          onToggle={(reaction, on) => react.mutate({ reaction, on })}
        />
        {mayRemove ? (
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="ml-auto rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-content disabled:opacity-50"
          >
            Take down the thread
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AnswerCard({ answer, people }: { answer: Reply; people: ReadonlyMap<string, Member> }) {
  return (
    <a
      href={`#reply-${answer.id}`}
      className="mt-4 block rounded-xl bg-emerald-500/10 p-4 ring-1 ring-emerald-400/40 transition-colors hover:bg-emerald-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      <p className="text-xs font-semibold text-emerald-300">
        Answered by {people.get(answer.authorId)?.name ?? 'someone'}
      </p>
      <p className="mt-1 line-clamp-3 text-sm text-content">{answer.body}</p>
    </a>
  );
}

/** Who may do what on this thread. */
function permissionsOn(thread: Thread, me: string | null, role: Role | undefined) {
  const moderator = role ? can(role, 'post:delete_any') : false;
  const asker = me === thread.authorId;
  return {
    mayMark: thread.kind === 'question' && (asker || moderator),
    mayModerate: moderator,
    mayReply: role ? can(role, 'post:comment') : false,
    mayRemove: asker || moderator,
  };
}

function Loaded({
  workspaceId,
  page,
  people,
  me,
  role,
}: {
  workspaceId: string;
  page: ThreadPage;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  role: Role | undefined;
}) {
  const { thread, replies, truncated } = page;
  const tree = useMemo(() => nestReplies(replies), [replies]);
  const { mayRemove, ...may } = permissionsOn(thread, me, role);
  const ctx: TreeContext = {
    workspaceId,
    threadId: thread.id,
    people,
    me,
    ...may,
    solvedReplyId: thread.solvedReplyId,
  };
  const answer = replies.find((r) => r.id === thread.solvedReplyId && !r.deleted);
  return (
    <>
      <nav aria-label="Breadcrumb" className="flex gap-1.5 text-xs text-faint">
        <Link href={spacesHref(workspaceId)} className="hover:text-content hover:underline">
          Spaces
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          href={spaceHref(workspaceId, thread.spaceId)}
          className="hover:text-content hover:underline"
        >
          {thread.spaceName}
        </Link>
      </nav>
      <ThreadArticle
        workspaceId={workspaceId}
        thread={thread}
        people={people}
        me={me}
        mayRemove={mayRemove}
      />
      {answer ? <AnswerCard answer={answer} people={people} /> : null}
      {ctx.mayReply ? (
        <div className="mt-5">
          <ReplyBox ctx={ctx} label="Reply to the thread" />
        </div>
      ) : null}
      <section aria-label="Replies" className="mt-6">
        {tree.length === 0 ? (
          <p className="text-sm text-faint">No replies yet.</p>
        ) : (
          <ReplyList nodes={tree} ctx={ctx} />
        )}
        {truncated ? (
          <p className="mt-3 text-xs text-faint">
            The first replies are shown; this thread has more than a page holds.
          </p>
        ) : null}
      </section>
    </>
  );
}

export function ThreadView({ workspaceId, threadId }: { workspaceId: string; threadId: string }) {
  const { role } = useWorkspaceRole();
  const { people } = usePeople(workspaceId);
  const me = useMyId();
  const page = useQuery({
    queryKey: threadKey(workspaceId, threadId),
    queryFn: () => call(contracts['spaces.thread'], { params: { workspaceId, threadId } }),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      {page.isError ? (
        <p role="alert" className="text-sm text-muted">
          This thread could not be loaded. It may have been taken down.{' '}
          <Link href={spacesHref(workspaceId)} className="text-accent-soft hover:underline">
            Back to Spaces
          </Link>
        </p>
      ) : page.data ? (
        <Loaded workspaceId={workspaceId} page={page.data} people={people} me={me} role={role} />
      ) : (
        <div className="space-y-3" aria-hidden="true">
          <div className="h-6 w-2/3 animate-pulse rounded bg-raised" />
          <div className="h-24 animate-pulse rounded-xl bg-raised" />
        </div>
      )}
    </div>
  );
}
