'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CameraCapture } from '../welcome/camera-capture.tsx';

/**
 * The ways to put a picture in the room (B2), beside the message box:
 * choose one, or take one. A phone opens its own camera from the file
 * input; a desktop shows a live preview in a small window. Pasting a
 * screenshot into the box is the third way, handled by the composer.
 */

const QUIET =
  'rounded-md border border-line px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-surface hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50';

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(window.matchMedia('(pointer: coarse)').matches), []);
  return coarse;
}

export function PictureButtons({
  disabled,
  sending,
  onPicture,
}: {
  disabled: boolean;
  sending: boolean;
  onPicture: (image: Blob) => void;
}) {
  const coarse = useCoarsePointer();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);

  function picked(files: FileList | null) {
    for (const file of files ?? []) onPicture(file);
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          picked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          picked(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={QUIET}
        disabled={disabled || sending}
        onClick={() => fileInput.current?.click()}
        aria-label="Send a picture"
      >
        {sending ? 'Sending…' : 'Photo'}
      </button>
      <button
        type="button"
        className={QUIET}
        disabled={disabled || sending}
        onClick={() => (coarse ? cameraInput.current?.click() : setCamera(true))}
        aria-label="Take a photo"
      >
        Camera
      </button>
      {camera ? (
        <CameraDialog
          onClose={() => setCamera(false)}
          onCapture={(frame) => {
            setCamera(false);
            onPicture(frame);
          }}
        />
      ) : null}
    </>
  );
}

/** A live preview, on a desktop, and the button that takes the picture. */
function CameraDialog({
  onClose,
  onCapture,
}: {
  onClose: () => void;
  onCapture: (frame: Blob) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, []);

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
      className="palette m-0 mx-auto mt-[8vh] w-[min(30rem,calc(100%-2rem))] overscroll-contain rounded-2xl border border-line bg-raised p-0 text-content shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 id={titleId} className="text-sm font-semibold">
          Take a photo
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
        >
          Close
        </button>
      </div>
      <div className="p-5">
        <CameraCapture shape="landscape" busy={false} onCapture={onCapture} />
      </div>
    </dialog>
  );
}
