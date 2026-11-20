'use client';

import { contracts, STORY_TEXT_MAX_LENGTH, STORY_TONES } from '@robis/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';
import { uploadable } from '../issues/attachments.tsx';
import { CameraCapture } from '../welcome/camera-capture.tsx';
import { type StoryTone, storiesKey, TONE_BACKGROUNDS, TONE_NAMES } from './story-model.ts';

/**
 * Post a story (B2): a photo (chosen, taken with the camera, or pasted) or
 * a few words on a colour. A photo goes through the device's sync queue, so
 * one taken with no signal posts itself, once, when the network is back.
 */

type Mode = 'photo' | 'text';
type Status = { kind: 'error' | 'note'; text: string } | null;

/** A phone opens its own camera from a file input; a desktop shows a live preview. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(window.matchMedia('(pointer: coarse)').matches), []);
  return coarse;
}

export function StoryComposer({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('photo');
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  async function postPhoto(image: Blob) {
    setBusy(true);
    setStatus(null);
    const engine = getSyncEngine();
    let id: string;
    try {
      const ready = await uploadable(image);
      id = await engine.queueStory(workspaceId, ready, ready.type);
    } catch (cause) {
      setStatus({ kind: 'error', text: (cause as Error).message });
      setBusy(false);
      return;
    }
    // Saved on the device now, whatever happens next. A drain already
    // running may have started before it was queued, so ask until this
    // one has gone, or is plainly waiting for the network.
    const waiting = async () => (await engine.pendingStories(workspaceId)).some((p) => p.id === id);
    let refused: string | undefined;
    for (let attempt = 0; attempt < 2 && (await waiting()); attempt++) {
      const result = await engine.flush().catch(() => null);
      refused ??= result?.refused.find((item) => item.kind === 'story.upload')?.message;
    }
    await queryClient.invalidateQueries({ queryKey: storiesKey(workspaceId) });
    setBusy(false);
    if (refused) setStatus({ kind: 'error', text: refused });
    else if (await waiting()) {
      setStatus({
        kind: 'note',
        text: 'Saved on this device. It posts on its own when you are back online.',
      });
    } else onClose();
  }

  async function postText(body: string, tone: StoryTone) {
    setBusy(true);
    setStatus(null);
    try {
      await call(contracts['stories.createText'], {
        params: { workspaceId },
        body: { body, tone },
      });
      await queryClient.invalidateQueries({ queryKey: storiesKey(workspaceId) });
      onClose();
    } catch (cause) {
      setStatus({
        kind: 'error',
        text: cause instanceof ApiError ? cause.message : 'That did not post. Try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      className="palette m-0 mx-auto mt-[4vh] max-h-[92dvh] overscroll-contain w-[min(26rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-line bg-raised p-0 text-content shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          New story
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Close
        </button>
      </div>

      <div className="px-5 pt-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1">
          {(['photo', 'text'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={mode === kind}
              onClick={() => {
                setMode(kind);
                setStatus(null);
              }}
              className={`rounded-md py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
                mode === kind ? 'bg-raised text-content shadow-sm' : 'text-muted hover:text-content'
              }`}
            >
              {kind === 'photo' ? 'Photo' : 'Words'}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 pb-5 pt-4">
        {mode === 'photo' ? (
          <PhotoStep busy={busy} onPost={postPhoto} />
        ) : (
          <TextStep busy={busy} onPost={postText} />
        )}
        <div aria-live="polite">
          {status ? (
            <p
              className={`mt-3 text-sm ${status.kind === 'error' ? 'text-danger-soft' : 'text-muted'}`}
            >
              {status.text}
            </p>
          ) : null}
        </div>
        <p className="mt-4 text-xs text-faint">
          Seen by this workspace for 24 hours, then gone. Photos are stored without their location.
        </p>
      </div>
    </dialog>
  );
}

/** Choose, take or paste a photo; see it as it will show; post it. */
function PhotoStep({ busy, onPost }: { busy: boolean; onPost: (image: Blob) => void }) {
  const coarse = useCoarsePointer();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);

  useEffect(() => {
    if (!image) return setPreview(null);
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  // A screenshot pasted while the composer is open becomes the photo.
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      setCamera(false);
      setImage(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  function picked(files: FileList | null) {
    const file = files?.[0];
    if (file) {
      setCamera(false);
      setImage(file);
    }
  }

  const quiet =
    'rounded-lg border border-line px-3 py-2 text-sm text-content transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50';

  return (
    <div>
      {camera ? (
        <CameraCapture
          shape="portrait"
          busy={busy}
          onCapture={(frame) => {
            setCamera(false);
            setImage(frame);
          }}
        />
      ) : preview ? (
        // biome-ignore lint/performance/noImgElement: a local object URL, never fetched
        <img
          src={preview}
          alt="Your story, as it will show"
          width={270}
          height={480}
          className="mx-auto aspect-[9/16] h-[min(52dvh,26rem)] rounded-2xl bg-black object-contain"
        />
      ) : (
        <div className="grid aspect-[9/16] h-[min(40dvh,20rem)] mx-auto place-items-center rounded-2xl border border-dashed border-line px-6 text-center text-sm text-muted">
          Choose a photo, take one, or paste a screenshot here.
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => picked(event.target.files)}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => picked(event.target.files)}
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={quiet}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          Choose a photo
        </button>
        <button
          type="button"
          className={quiet}
          disabled={busy}
          onClick={() => (coarse ? cameraInput.current?.click() : setCamera((on) => !on))}
        >
          {camera ? 'Put the camera away' : 'Take one'}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          disabled={!image || busy}
          onClick={() => image && onPost(image)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

/** A few words on a colour, seen as they will show while you write them. */
function TextStep({
  busy,
  onPost,
}: {
  busy: boolean;
  onPost: (body: string, tone: StoryTone) => void;
}) {
  const [body, setBody] = useState('');
  const [tone, setTone] = useState<StoryTone>('dusk');
  const fieldId = useId();
  const words = body.trim();

  return (
    <div>
      <label htmlFor={fieldId} className="sr-only">
        What is happening
      </label>
      <div
        className="grid aspect-[9/16] h-[min(40dvh,20rem)] mx-auto place-items-center rounded-2xl px-5"
        style={{ backgroundImage: TONE_BACKGROUNDS[tone] }}
      >
        <textarea
          id={fieldId}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={STORY_TEXT_MAX_LENGTH}
          rows={5}
          name="story"
          autoComplete="off"
          placeholder="What is happening…"
          className="w-full resize-none bg-transparent text-center text-xl font-semibold leading-snug text-white placeholder:text-white/60 focus:outline-none"
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <fieldset className="flex gap-2">
          <legend className="sr-only">Colour</legend>
          {STORY_TONES.map((name) => (
            <label key={name} className="relative cursor-pointer">
              <input
                type="radio"
                name="story-tone"
                value={name}
                checked={tone === name}
                onChange={() => setTone(name)}
                className="peer sr-only"
              />
              <span className="sr-only">{TONE_NAMES[name]}</span>
              <span
                aria-hidden="true"
                style={{ backgroundImage: TONE_BACKGROUNDS[name] }}
                className={`block h-7 w-7 rounded-full ring-offset-2 ring-offset-raised transition-transform peer-focus-visible:ring-2 peer-focus-visible:ring-accent-soft ${
                  tone === name ? 'scale-110 ring-2 ring-content' : 'hover:scale-105'
                }`}
              />
            </label>
          ))}
        </fieldset>
        <span className="text-xs tabular-nums text-faint">
          {body.length}/{STORY_TEXT_MAX_LENGTH}
        </span>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!words || busy}
          onClick={() => onPost(words, tone)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
