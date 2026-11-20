'use client';

import { contracts, POST_MAX_LENGTH } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { sendImage } from '../../lib/upload.ts';
import { uploadable } from '../issues/attachments.tsx';
import { feedKey, type Post } from './feed-model.ts';

/**
 * Post to the feed (Phase 2c): a few words, a photo, or both. A photo goes
 * up first and its words are added to it; pasting a screenshot into the box
 * makes it the photo.
 */
export function PostComposer({
  workspaceId,
  draft = null,
}: {
  workspaceId: string;
  /** Words to start from, such as a well done; a new `at` starts again. */
  draft?: { words: string; at: number } | null;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!draft) return;
    // Added to what is already there, never in place of it.
    setBody((current) => (current.trim() ? `${current.trimEnd()}\n${draft.words}` : draft.words));
    const box = field.current;
    if (!box) return;
    box.focus({ preventScroll: true });
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    requestAnimationFrame(() => box.setSelectionRange(box.value.length, box.value.length));
  }, [draft]);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) return setPreview(null);
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function post() {
    const words = body.trim();
    if (photo) {
      const { post: made } = await sendImage<{ post: Post }>(
        'POST',
        `/workspaces/${workspaceId}/posts/photo`,
        await uploadable(photo),
        crypto.randomUUID(),
      );
      if (words) {
        await call(contracts['posts.update'], {
          params: { workspaceId, postId: made.id },
          body: { body: words },
        });
      }
      return;
    }
    await call(contracts['posts.create'], { params: { workspaceId }, body: { body: words } });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!photo && !body.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await post();
      setBody('');
      setPhoto(null);
      await queryClient.invalidateQueries({ queryKey: feedKey(workspaceId) });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That did not post. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-line bg-raised p-4">
      <label htmlFor={fieldId} className="sr-only">
        Share something with the team
      </label>
      <textarea
        ref={field}
        id={fieldId}
        name="post"
        autoComplete="off"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onPaste={(event) => {
          const image = [...event.clipboardData.items]
            .find((item) => item.type.startsWith('image/'))
            ?.getAsFile();
          if (!image) return;
          event.preventDefault();
          setPhoto(image);
        }}
        maxLength={POST_MAX_LENGTH}
        rows={2}
        placeholder="Share something with the team…"
        className="w-full resize-none bg-transparent text-sm text-content placeholder:text-faint focus:outline-none"
      />
      {preview ? (
        <div className="relative mt-2 inline-block">
          {/* biome-ignore lint/performance/noImgElement: a local object URL, never fetched */}
          <img
            src={preview}
            alt="Your photo, ready to post"
            width={320}
            height={240}
            className="max-h-60 w-auto rounded-lg border border-line object-contain"
          />
          <button
            type="button"
            onClick={() => setPhoto(null)}
            className="absolute right-2 top-2 rounded-full border border-line bg-raised/90 px-2 py-0.5 text-xs text-content transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Remove
          </button>
        </div>
      ) : null}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setPhoto(file);
          e.target.value = '';
        }}
      />
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Photo
        </button>
        <div aria-live="polite" className="min-w-0 flex-1">
          {error ? <p className="text-xs text-danger-soft">{error}</p> : null}
        </div>
        <button
          type="submit"
          disabled={busy || (!photo && !body.trim())}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  );
}
