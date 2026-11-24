'use client';

import { contracts, SPACE_REPLY_MAX_LENGTH } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { ApiError, call, type Member } from '../../lib/api.ts';
import type { Reaction } from '../feed/feed-model.ts';
import { ReactionBar } from '../feed/reaction-bar.tsx';
import { descendants, type ReplyNode, threadKey } from './spaces-model.ts';

/**
 * A thread's replies as a tree: each reply with its reactions, Reply, and
 * for whoever asked a question, Mark as the answer. A branch can be hidden.
 * A reply taken down keeps its place, so the replies under it still read.
 */

const QUIET =
  'rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50';

export type TreeContext = {
  workspaceId: string;
  threadId: string;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  /** May mark the answer: the asker of a question, or an admin. */
  mayMark: boolean;
  /** May take down anyone's reply. */
  mayModerate: boolean;
  /** May reply at all. */
  mayReply: boolean;
  solvedReplyId: string | null;
};

export function ReplyBox({
  ctx,
  parentId,
  onDone,
  autoFocus = false,
  label,
}: {
  ctx: TreeContext;
  parentId?: string;
  onDone?: () => void;
  autoFocus?: boolean;
  label: string;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () =>
      call(contracts['spaces.reply'], {
        params: { workspaceId: ctx.workspaceId, threadId: ctx.threadId },
        body: { body: body.trim(), ...(parentId ? { parentId } : {}) },
      }),
    onSuccess: () => {
      setBody('');
      void queryClient.invalidateQueries({ queryKey: threadKey(ctx.workspaceId, ctx.threadId) });
      onDone?.();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (body.trim() && !send.isPending) send.mutate();
  }
  // Cmd or Ctrl with Enter sends, as in chat; Escape closes a nested box.
  function keys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit(event);
    if (event.key === 'Escape' && onDone) onDone();
  }
  return (
    <form onSubmit={submit} aria-label={label} className="space-y-2">
      <textarea
        aria-label={label}
        // biome-ignore lint/a11y/noAutofocus: opened by pressing Reply, so focus belongs in it
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={keys}
        maxLength={SPACE_REPLY_MAX_LENGTH}
        placeholder="Write a reply"
        className="min-h-20 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={send.isPending || !body.trim()}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {send.isPending ? 'Sending…' : 'Reply'}
        </button>
        {onDone ? (
          <button type="button" onClick={onDone} className={QUIET}>
            Cancel
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-faint">Ctrl or ⌘ with Enter sends</span>
      </div>
      {send.error ? (
        <p role="alert" className="text-xs text-danger-soft">
          {send.error instanceof ApiError ? send.error.message : 'That did not send. Try again.'}
        </p>
      ) : null}
    </form>
  );
}

function useReplyActions(ctx: TreeContext) {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: threadKey(ctx.workspaceId, ctx.threadId) });
  const react = useMutation({
    mutationFn: ({ id, reaction, on }: { id: string; reaction: Reaction; on: boolean }) =>
      call(contracts[on ? 'spaces.react' : 'spaces.unreact'], {
        params: { workspaceId: ctx.workspaceId, targetId: id, reaction },
      }),
    onSettled: refresh,
  });
  const mark = useMutation({
    mutationFn: (replyId: string | null) =>
      call(contracts['spaces.solve'], {
        params: { workspaceId: ctx.workspaceId, threadId: ctx.threadId },
        body: { replyId },
      }),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (replyId: string) =>
      call(contracts['spaces.deleteReply'], {
        params: { workspaceId: ctx.workspaceId, replyId },
      }),
    onSettled: refresh,
  });
  return { react, mark, remove };
}

function ReplyHeader({ node, ctx }: { node: ReplyNode; ctx: TreeContext }) {
  if (node.deleted) return <p className="text-xs text-faint">Taken down</p>;
  const author = ctx.people.get(node.authorId);
  const name = author?.name ?? 'Someone';
  return (
    <div className="flex items-center gap-2 text-xs">
      <Avatar name={name} seed={node.authorId} avatar={author?.avatar ?? null} size="sm" />
      <span className="font-medium text-content">{name}</span>
      <span className="text-faint">{ago(node.createdAt)}</span>
      {ctx.solvedReplyId === node.id ? (
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
          The answer
        </span>
      ) : null}
    </div>
  );
}

/** Reply, Mark as the answer, and Take down, each for whoever may. */
function ReplyActions({
  node,
  ctx,
  onReply,
}: {
  node: ReplyNode;
  ctx: TreeContext;
  onReply: () => void;
}) {
  const { mark, remove } = useReplyActions(ctx);
  const isAnswer = ctx.solvedReplyId === node.id;
  const mayRemove = ctx.me === node.authorId || ctx.mayModerate;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-0.5">
      {ctx.mayReply ? (
        <button type="button" className={QUIET} onClick={onReply}>
          Reply
        </button>
      ) : null}
      {ctx.mayMark ? (
        <button
          type="button"
          className={QUIET}
          disabled={mark.isPending}
          onClick={() => mark.mutate(isAnswer ? null : node.id)}
        >
          {isAnswer ? 'Not the answer' : 'Mark as the answer'}
        </button>
      ) : null}
      {mayRemove ? (
        <button
          type="button"
          className={QUIET}
          disabled={remove.isPending}
          onClick={() => remove.mutate(node.id)}
        >
          Take down
        </button>
      ) : null}
    </div>
  );
}

function ReplyBody({
  node,
  ctx,
  onReply,
}: {
  node: ReplyNode;
  ctx: TreeContext;
  onReply: () => void;
}) {
  const { react } = useReplyActions(ctx);
  return (
    <>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-content">
        {node.body}
      </p>
      <div className="mt-2">
        <ReactionBar
          reactions={node.reactions}
          people={ctx.people}
          me={ctx.me}
          pending={react.isPending}
          onToggle={(reaction, on) => react.mutate({ id: node.id, reaction, on })}
          only={['helpful', 'thanks', 'insightful', 'celebrate']}
        />
      </div>
      <ReplyActions node={node} ctx={ctx} onReply={onReply} />
    </>
  );
}

/** The replies under a reply, behind Hide and Show. */
function Branch({ node, ctx }: { node: ReplyNode; ctx: TreeContext }) {
  const [hidden, setHidden] = useState(false);
  const under = descendants(node);
  if (under === 0) return null;
  return (
    <div className="ml-4 border-l border-line pl-3 sm:ml-6 sm:pl-4">
      <button
        type="button"
        aria-expanded={!hidden}
        onClick={() => setHidden(!hidden)}
        className="mb-1 mt-0.5 text-[11px] text-faint hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
      >
        {hidden ? `Show ${under} more ${under === 1 ? 'reply' : 'replies'}` : 'Hide replies'}
      </button>
      {hidden ? null : <ReplyList nodes={node.children} ctx={ctx} />}
    </div>
  );
}

function ReplyItem({ node, ctx }: { node: ReplyNode; ctx: TreeContext }) {
  const [replying, setReplying] = useState(false);
  const isAnswer = ctx.solvedReplyId === node.id;
  const name = ctx.people.get(node.authorId)?.name ?? 'Someone';
  return (
    <li id={`reply-${node.id}`} className="scroll-mt-24">
      <div
        className={`rounded-xl p-3 ${isAnswer ? 'bg-emerald-500/10 ring-1 ring-emerald-400/40' : ''}`}
      >
        <ReplyHeader node={node} ctx={ctx} />
        {node.deleted ? null : (
          <ReplyBody node={node} ctx={ctx} onReply={() => setReplying(true)} />
        )}
        {replying ? (
          <div className="mt-2">
            <ReplyBox
              ctx={ctx}
              parentId={node.id}
              autoFocus
              onDone={() => setReplying(false)}
              label={`Reply to ${name}`}
            />
          </div>
        ) : null}
      </div>
      <Branch node={node} ctx={ctx} />
    </li>
  );
}

export function ReplyList({ nodes, ctx }: { nodes: ReplyNode[]; ctx: TreeContext }) {
  return (
    <ul className="space-y-1">
      {nodes.map((node) => (
        <ReplyItem key={node.id} node={node} ctx={ctx} />
      ))}
    </ul>
  );
}
