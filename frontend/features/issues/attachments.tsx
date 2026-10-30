'use client';

import { can, contracts, type ResponseOf, type Role, sniffImage } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BASE_URL, call } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';

/** An image on an issue or comment, as the contract describes it. */
export type Attachment = ResponseOf<(typeof contracts)['attachments.list']>['attachments'][number];

const MAX_BYTES = 8 * 1024 * 1024;

/** Redraw on a white canvas as a JPEG, scaled to fit. White, so a transparent PNG is not flattened onto black. */
async function redraw(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('This browser cannot open that image. Try a JPEG or PNG.');
  }
  const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the image');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  } finally {
    bitmap.close();
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.9),
  );
  if (!blob) throw new Error('That image could not be prepared');
  if (blob.size > MAX_BYTES) throw new Error('That image is still larger than 8 MB');
  return blob;
}

/**
 * Something the server will take.
 *
 * The real format is read from the file's first bytes, not trusted from its
 * name, so a mislabelled file is sent under the type it actually is. A
 * supported image under the limit goes up unchanged, so a screenshot stays a
 * crisp PNG; anything else (a phone's HEIC, an oversized photo) is redrawn
 * as a JPEG first.
 */
export async function uploadable(file: Blob): Promise<Blob> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const actual = sniffImage(head);
  if (actual && file.size <= MAX_BYTES) {
    return actual === file.type ? file : new Blob([file], { type: actual });
  }
  return redraw(file);
}

/** Object URLs for queued images, revoked when they are no longer shown. */
function usePendingPreviews(issueId: string, revision: number) {
  const [previews, setPreviews] = useState<{ id: string; src: string }[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `revision` is the signal that the queue changed and must be read again
  useEffect(() => {
    let cancelled = false;
    let made: string[] = [];

    void getSyncEngine()
      .pendingAttachments(issueId)
      .then((waiting) => {
        if (cancelled) return;
        made = waiting.map((item) => URL.createObjectURL(item.image));
        setPreviews(waiting.map((item, index) => ({ id: item.id, src: made[index]! })));
      });

    return () => {
      cancelled = true;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [issueId, revision]);

  return previews;
}

/**
 * Images on an issue: add from the device or the camera, or paste a
 * screenshot anywhere on the page.
 *
 * Every image goes through the offline queue, so one added on a train waits
 * on the device -- shown here as waiting -- and uploads exactly once when the
 * network returns. Clicking an image opens it full size.
 */
export function IssueAttachments({
  workspaceId,
  issueId,
  role,
}: {
  workspaceId: string;
  issueId: string;
  role: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Attachment | null>(null);

  const key = useMemo(() => ['attachments', workspaceId, issueId] as const, [workspaceId, issueId]);
  const list = useQuery({
    queryKey: key,
    queryFn: () => call(contracts['attachments.list'], { params: { workspaceId, issueId } }),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  const pending = usePendingPreviews(issueId, revision);

  const canAdd = role !== undefined && can(role, 'attachment:create');

  const flush = useCallback(async () => {
    const result = await getSyncEngine().flush();
    // An image the server will never take is dropped from the queue; say so
    // rather than let its "waiting" tile quietly disappear.
    const refused = result.refused.find((item) => item.kind === 'attachment.upload');
    if (refused) setError(`An image could not be added: ${refused.message}`);
    setRevision((n) => n + 1);
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  // The network coming back is the moment a queued image can go up.
  useEffect(() => {
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  async function add(files: FileList | File[] | null) {
    setError(null);
    for (const file of files ?? []) {
      if (!file.type.startsWith('image/')) {
        setError('Only images can be attached for now.');
        continue;
      }
      try {
        const image = await uploadable(file);
        await getSyncEngine().queueAttachment(workspaceId, issueId, image, image.type);
      } catch (cause) {
        setError((cause as Error).message);
      }
    }
    setRevision((n) => n + 1);
    await flush();
  }

  const remove = useMutation({
    mutationFn: (attachment: Attachment) =>
      call(contracts['attachments.delete'], {
        params: { workspaceId, attachmentId: attachment.id },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  // Paste a screenshot anywhere on the page, unless typing in a field.
  useEffect(() => {
    if (!canAdd) return;
    function onPaste(event: globalThis.ClipboardEvent) {
      // The target can be the window or a text node, neither of which has
      // `closest`; only an element can be a field someone is typing in.
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return;
      }
      const images = [...(event.clipboardData?.items ?? [])]
        .filter((item) => item.type.startsWith('image/'))
        .flatMap((item) => item.getAsFile() ?? []);
      if (images.length > 0) {
        event.preventDefault();
        void add(images);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // A comment's images are shown under that comment, not here.
  const items = (list.data?.attachments ?? []).filter((item) => item.commentId === null);
  const nothing = items.length === 0 && pending.length === 0;
  if (nothing && !canAdd) return null;

  return (
    <section className="mt-8" aria-labelledby={`${issueId}-attachments`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2
          id={`${issueId}-attachments`}
          className="text-xs font-medium uppercase tracking-wide text-faint"
        >
          Images{items.length > 0 ? <span className="ml-2">{items.length}</span> : null}
        </h2>

        {canAdd ? (
          <div className="flex items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                void add(event.target.files);
                event.target.value = '';
              }}
            />
            <input
              ref={cameraInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                void add(event.target.files);
                event.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => cameraInput.current?.click()}
              className="rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft sm:hidden"
            >
              Camera
            </button>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-line px-2.5 py-1 text-xs text-content transition-colors hover:border-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
            >
              Add image
            </button>
          </div>
        ) : null}
      </div>

      {nothing ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-faint">
          No images yet. Add one, or paste a screenshot anywhere on this page.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((item) => {
            const mine = me.data?.user.id === item.uploaderId;
            const deletable =
              role !== undefined &&
              (mine ? can(role, 'attachment:delete_own') : can(role, 'attachment:delete_any'));
            return (
              <li key={item.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setOpen(item)}
                  className="block aspect-square w-full overflow-hidden rounded-lg border border-line bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
                  aria-label="Open image"
                >
                  {/* biome-ignore lint/performance/noImgElement: served by the API with the session cookie */}
                  <img
                    src={`${BASE_URL}${item.url}`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                </button>
                {deletable ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(item)}
                    aria-label="Remove image"
                    className="absolute right-1.5 top-1.5 rounded-full bg-surface/85 px-2 py-0.5 text-xs text-muted opacity-0 backdrop-blur transition-opacity hover:text-danger-soft focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            );
          })}
          {pending.map((item) => (
            <li key={item.id} className="relative">
              {/* biome-ignore lint/performance/noImgElement: a local object URL */}
              <img
                src={item.src}
                alt=""
                className="aspect-square w-full rounded-lg border border-dashed border-line object-cover opacity-60"
              />
              <span className="absolute inset-x-1.5 bottom-1.5 rounded bg-surface/85 px-1.5 py-0.5 text-center text-[11px] text-muted backdrop-blur">
                Waiting to upload
              </span>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {error}
        </p>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image"
          tabIndex={-1}
          onClick={() => setOpen(null)}
          onKeyDown={(event) => event.key === 'Escape' && setOpen(null)}
          ref={(element) => element?.focus()}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4 backdrop-blur-sm"
        >
          {/* biome-ignore lint/performance/noImgElement: served by the API with the session cookie */}
          <img
            src={`${BASE_URL}${open.url}`}
            alt=""
            className="max-h-full max-w-full rounded-lg shadow-2xl"
            style={{ aspectRatio: `${open.width} / ${open.height}` }}
          />
        </div>
      ) : null}
    </section>
  );
}
