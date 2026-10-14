'use client';

import { splitMentions } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ClipboardEvent, type FormEvent, useEffect, useState } from 'react';
import { type Attachment, uploadable } from '../features/issues/attachments.tsx';
import { api, BASE_URL, type Comment, type Me } from '../lib/api.ts';
import { useMemberAvatars } from '../lib/use-member-avatars.ts';
import { DeleteButton } from './delete-button.tsx';
import { Avatar } from './ui/avatar.tsx';

/** Comments have no title, so the dialog quotes the opening of the body. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `“${flat.slice(0, 60)}…”` : `“${flat}”`;
}

/**
 * Comments on an issue.
 *
 * `@handle` in the body is picked up by the worker and turned into a
 * notification for that person, so the composer hints at it. Resolution
 * happens server-side against workspace members -- the client deliberately
 * does not autocomplete, because an unresolvable handle is harmless and
 * pretending otherwise would mean shipping the member list to render a textbox.
 */
export function CommentThread({
  workspaceId,
  issueId,
  canComment,
}: {
  workspaceId: string;
  issueId: string;
  canComment: boolean;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  // Images pasted into the comment box, attached once the comment exists.
  const [drafts, setDrafts] = useState<File[]>([]);

  const avatars = useMemberAvatars();
  const key = ['comments', workspaceId, issueId] as const;
  const path = `/workspaces/${workspaceId}/issues/${issueId}/comments`;

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

  const comments = useQuery({
    queryKey: key,
    queryFn: () => api<{ comments: Comment[] }>(path),
  });

  const attachmentsKey = ['attachments', workspaceId, issueId] as const;
  const attachments = useQuery({
    queryKey: attachmentsKey,
    queryFn: () =>
      api<{ attachments: Attachment[] }>(`${path.replace(/\/comments$/, '')}/attachments`),
  });

  /*
   * A comment and its images are separate requests. If an image fails after
   * the comment is posted, the comment is kept (`posted`) and only the images
   * still waiting are retried, so trying again never posts the words twice.
   */
  const [posted, setPosted] = useState<string | null>(null);

  const post = useMutation({
    mutationFn: async (text: string) => {
      let commentId = posted;
      if (!commentId) {
        const created = await api<{ comment: Comment }>(path, {
          method: 'POST',
          body: { body: text },
        });
        commentId = created.comment.id;
        setPosted(commentId);
        setBody('');
        queryClient.invalidateQueries({ queryKey: key });
      }

      // Comments need a connection anyway, so their images upload directly
      // rather than through the offline queue the issue's own images use.
      for (const file of drafts) {
        const image = await uploadable(file);
        const response = await fetch(
          `${BASE_URL}${path.replace(/\/comments$/, '')}/attachments?commentId=${commentId}`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': image.type },
            body: image,
          },
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            `The comment was posted, but an image was not attached: ${payload?.message ?? response.status}`,
          );
        }
        setDrafts((current) => current.filter((draft) => draft !== file));
        queryClient.invalidateQueries({ queryKey: attachmentsKey });
      }
    },
    onSuccess: () => {
      setPosted(null);
      setDrafts([]);
      queryClient.invalidateQueries({ queryKey: attachmentsKey });
    },
  });

  function onPasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.items]
      .filter((item) => item.type.startsWith('image/'))
      .flatMap((item) => item.getAsFile() ?? []);
    if (images.length === 0) return;
    event.preventDefault();
    setDrafts((current) => [...current, ...images]);
  }

  const remove = useMutation({
    mutationFn: (commentId: string) =>
      api<void>(`/workspaces/${workspaceId}/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    // After a partial failure the words are already posted; only images remain.
    if (text || posted) post.mutate(text);
  }

  const items = comments.data?.comments ?? [];

  return (
    <section className="mt-12">
      <h2 className="text-sm font-medium uppercase tracking-wide text-faint">
        Comments{items.length > 0 && <span className="ml-2 text-faint">{items.length}</span>}
      </h2>

      <ul className="mt-3 space-y-3">
        {items.map((comment) => (
          <li key={comment.id} className="rounded-lg border border-line bg-raised p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2">
                <Avatar
                  name={comment.authorName}
                  seed={comment.authorId}
                  avatar={avatars.get(comment.authorId) ?? null}
                  size="sm"
                />
                <span className="text-sm font-medium text-content">{comment.authorName}</span>
              </span>

              <span className="flex items-center gap-3">
                <time className="text-xs text-faint" dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString()}
                </time>

                {/* Own comments only; the API also refuses others unless you
                    are an admin, so this just avoids offering a dead control. */}
                <DeleteButton
                  allowed={me.data?.user.id === comment.authorId}
                  kind="comment"
                  name={preview(comment.body)}
                  onConfirm={() => remove.mutateAsync(comment.id)}
                  className="-my-1"
                />
              </span>
            </div>

            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">
              <Mentions text={comment.body} />
            </p>

            <CommentImages
              items={(attachments.data?.attachments ?? []).filter(
                (a) => a.commentId === comment.id,
              )}
            />
          </li>
        ))}
      </ul>

      {items.length === 0 && comments.isSuccess && (
        <p className="mt-3 text-sm text-faint">No comments yet.</p>
      )}

      {canComment && (
        <form onSubmit={onSubmit} className="mt-4">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onPaste={onPasteImage}
            placeholder="Leave a comment. Use @name to notify someone, or paste a screenshot."
            rows={3}
            aria-label="New comment"
            className="w-full resize-none rounded-md border border-line bg-raised px-3 py-2 text-sm text-content outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
          />

          {drafts.length > 0 ? (
            <DraftImages
              files={drafts}
              onRemove={(index) => setDrafts((current) => current.filter((_, i) => i !== index))}
            />
          ) : null}

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-faint">
              Mention a teammate by @username to notify them.
            </span>

            <button
              type="submit"
              disabled={post.isPending || (!body.trim() && !posted)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {posted ? 'Retry images' : 'Comment'}
            </button>
          </div>
        </form>
      )}

      {post.isError && (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {(post.error as Error).message}
        </p>
      )}
    </section>
  );
}

/**
 * Highlight `@handle` so a mention is visible in the rendered comment.
 *
 * The split comes from `@robis/shared` rather than a regex here, so what gets
 * highlighted is exactly what gets notified.
 */
function Mentions({ text }: { text: string }) {
  return (
    <>
      {splitMentions(text).map((segment, index) =>
        segment.handle ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional and re-rendered wholesale, so the index is the only identity available.
          <span key={index} className="rounded bg-accent/15 px-1 text-accent-soft">
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/** A comment's own images, small, each opening full size in a new tab. */
function CommentImages({ items }: { items: Attachment[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`${BASE_URL}${item.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block h-20 w-20 overflow-hidden rounded-md border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            aria-label="Open image"
          >
            {/* biome-ignore lint/performance/noImgElement: served by the API with the session cookie */}
            <img
              src={`${BASE_URL}${item.url}`}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Pasted images waiting for the comment to be posted. */
function DraftImages({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const made = files.map((file) => URL.createObjectURL(file));
    setUrls(made);
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [files]);

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {urls.map((url, index) => (
        <li key={url} className="relative">
          {/* biome-ignore lint/performance/noImgElement: a local object URL */}
          <img src={url} alt="" className="h-16 w-16 rounded-md border border-line object-cover" />
          <button
            type="button"
            onClick={() => onRemove(index)}
            aria-label="Remove pasted image"
            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-surface text-xs text-muted ring-1 ring-line hover:text-content"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
