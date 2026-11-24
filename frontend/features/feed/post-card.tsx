'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { ApiError, BASE_URL, call, type Member } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/i18n/format.ts';
import { personHref } from '../../lib/links.ts';
import { StoryRing } from '../stories/story-ring.tsx';
import { feedKey, type Post, type Reaction } from './feed-model.ts';
import { FollowButton } from './follow-button.tsx';
import { ReactionBar } from './reaction-bar.tsx';

/**
 * One post on the feed (Phase 2c): who and when, the words or the photo,
 * its reactions shown as who reacted (never a total), and its comments
 * behind a button, so the feed stays a list to read rather than a wall.
 */

const QUIET =
  'rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50';

export function PostCard({
  workspaceId,
  post,
  people,
  me,
  role,
}: {
  workspaceId: string;
  post: Post;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  role: Role | undefined;
}) {
  const author = people.get(post.authorId);
  const name = author?.name ?? 'Someone';
  const [open, setOpen] = useState(false);

  return (
    <article className="rounded-xl border border-line bg-raised" aria-label={`Post by ${name}`}>
      <header className="flex items-center gap-3 px-4 pt-4">
        <StoryRing userId={post.authorId} name={name}>
          <Avatar name={name} seed={post.authorId} avatar={author?.avatar ?? null} size="md" />
        </StoryRing>
        <div className="min-w-0 flex-1 leading-tight">
          <Link
            href={personHref(workspaceId, post.authorId)}
            className="rounded text-sm font-medium text-content underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            {name}
          </Link>
          <p className="text-xs text-faint">
            <time dateTime={post.createdAt} title={formatDateTime(post.createdAt)}>
              {ago(post.createdAt)}
            </time>
            {post.editedAt ? ' · edited' : ''}
            {post.kind === 'checkin' ? ' · weekly check-in' : ''}
          </p>
        </div>
        {me && post.authorId !== me ? (
          <FollowButton workspaceId={workspaceId} userId={post.authorId} name={name} onlyToFollow />
        ) : null}
        <TakeDown workspaceId={workspaceId} post={post} me={me} role={role} />
      </header>

      {post.body ? (
        <p className="whitespace-pre-wrap break-words px-4 pt-3 text-sm leading-relaxed text-content">
          {post.body}
        </p>
      ) : null}
      {post.photo ? (
        <a
          href={`${BASE_URL}${post.photo.url}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 block bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          {/* biome-ignore lint/performance/noImgElement: members-only bytes with the session cookie */}
          <img
            src={`${BASE_URL}${post.photo.url}`}
            alt={`Shared by ${name}`}
            width={post.photo.width}
            height={post.photo.height}
            loading="lazy"
            decoding="async"
            className="mx-auto block h-auto max-h-[28rem] w-auto max-w-full object-contain"
          />
        </a>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 px-4 py-3">
        <Reactions workspaceId={workspaceId} post={post} people={people} me={me} />
        <span className="flex-1" />
        <button
          type="button"
          className={QUIET}
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {post.commentCount === 0
            ? 'Comment'
            : `${post.commentCount} ${post.commentCount === 1 ? 'comment' : 'comments'}`}
        </button>
      </footer>
      {open ? (
        <Comments workspaceId={workspaceId} post={post} people={people} me={me} role={role} />
      ) : null}
    </article>
  );
}

/** The reactions on a post, through the shared bar. */
function Reactions({
  workspaceId,
  post,
  people,
  me,
}: {
  workspaceId: string;
  post: Post;
  people: ReadonlyMap<string, Member>;
  me: string | null;
}) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: ({ reaction, on }: { reaction: Reaction; on: boolean }) =>
      call(contracts[on ? 'posts.react' : 'posts.unreact'], {
        params: { workspaceId, postId: post.id, reaction },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: feedKey(workspaceId) }),
  });
  return (
    <ReactionBar
      reactions={post.reactions}
      people={people}
      me={me}
      pending={toggle.isPending}
      onToggle={(reaction, on) => toggle.mutate({ reaction, on })}
    />
  );
}

/** Delete (yours) or take down (as an admin), asked once more first. */
function TakeDown({
  workspaceId,
  post,
  me,
  role,
}: {
  workspaceId: string;
  post: Post;
  me: string | null;
  role: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const [asked, setAsked] = useState(false);
  const mine = post.authorId === me;
  const remove = useMutation({
    mutationFn: () => call(contracts['posts.delete'], { params: { workspaceId, postId: post.id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: feedKey(workspaceId) }),
  });
  if (!role || !can(role, mine ? 'post:delete_own' : 'post:delete_any')) return null;
  return (
    <button
      type="button"
      className={QUIET}
      disabled={remove.isPending}
      onClick={() => (asked ? remove.mutate() : setAsked(true))}
      onBlur={() => setAsked(false)}
    >
      {asked ? (mine ? 'Delete it?' : 'Take it down?') : mine ? 'Delete' : 'Take down'}
    </button>
  );
}

function Comments({
  workspaceId,
  post,
  people,
  me,
  role,
}: {
  workspaceId: string;
  post: Post;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  role: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const key = ['post-comments', workspaceId, post.id] as const;
  const list = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['posts.comments'], { params: { workspaceId, postId: post.id } }),
  });
  const [body, setBody] = useState('');
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: key });
    await queryClient.invalidateQueries({ queryKey: feedKey(workspaceId) });
  };
  const add = useMutation({
    mutationFn: () =>
      call(contracts['posts.comment'], {
        params: { workspaceId, postId: post.id },
        body: { body },
      }),
    onSuccess: async () => {
      setBody('');
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (commentId: string) =>
      call(contracts['posts.deleteComment'], { params: { workspaceId, commentId } }),
    onSuccess: refresh,
  });
  const mayComment = role !== undefined && can(role, 'post:comment');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (body.trim()) add.mutate();
  }

  return (
    <div className="border-t border-line px-4 py-3">
      <ul className="space-y-3">
        {(list.data?.comments ?? []).map((comment) => {
          const by = people.get(comment.authorId);
          const own = comment.authorId === me;
          const removable =
            role !== undefined && can(role, own ? 'post:delete_own' : 'post:delete_any');
          return (
            <li key={comment.id} className="group flex gap-2.5">
              <Avatar
                name={by?.name ?? '?'}
                seed={comment.authorId}
                avatar={by?.avatar ?? null}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs">
                  <span className="font-medium text-content">{by?.name ?? 'Someone'}</span>{' '}
                  <span className="text-faint">{ago(comment.createdAt)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-muted">{comment.body}</p>
              </div>
              {removable ? (
                <button
                  type="button"
                  onClick={() => remove.mutate(comment.id)}
                  aria-label={`Delete comment from ${by?.name ?? 'someone'}`}
                  className="self-start rounded px-1.5 py-0.5 text-[10px] text-faint opacity-0 transition-opacity hover:text-danger-soft focus-visible:opacity-100 group-hover:opacity-100"
                >
                  Delete
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {mayComment ? (
        <form onSubmit={onSubmit} className="mt-3 flex gap-2">
          <label className="sr-only" htmlFor={`comment-${post.id}`}>
            Comment
          </label>
          <input
            id={`comment-${post.id}`}
            name="comment"
            autoComplete="off"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1000}
            placeholder="Write a comment…"
            className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none"
          />
          <button
            type="submit"
            disabled={!body.trim() || add.isPending}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            {add.isPending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : null}
      <div aria-live="polite">
        {add.error ? (
          <p className="mt-2 text-xs text-danger-soft">
            {add.error instanceof ApiError ? add.error.message : 'That did not send.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
