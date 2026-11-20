'use client';

import { useEffect, useRef, useState } from 'react';

type CameraState = 'starting' | 'live' | 'denied' | 'unavailable';

/**
 * A live front-camera preview in the same circle the picture will sit in.
 *
 * The preview is mirrored, as every selfie camera is, and the captured frame
 * is mirrored to match: people expect to get the picture they saw. Tracks
 * are stopped the moment this unmounts, so the camera light goes off as
 * soon as you leave this option. If permission is refused or there is no
 * camera, it says so and points back to uploading instead of failing quietly.
 */
export function CameraCapture({
  onCapture,
  busy,
  shape = 'circle',
}: {
  onCapture: (frame: Blob) => void;
  busy: boolean;
  /** A circle for a picture of you; a tall frame for a story (B2). */
  shape?: 'circle' | 'portrait';
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<CameraState>('starting');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;

    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then((media) => {
        if (cancelled) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream = media;
        if (video.current) video.current.srcObject = media;
        setState('live');
      })
      .catch((error: DOMException) => {
        if (!cancelled) setState(error.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      });

    return () => {
      cancelled = true;
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  function capture() {
    const element = video.current;
    if (!element || element.videoWidth === 0) return;

    // A centred square for a picture of you, the shape it is cropped to
    // anyway; for a story, the tallest 9:16 the frame holds.
    const { videoWidth: width, videoHeight: height } = element;
    const outWidth =
      shape === 'circle' ? Math.min(width, height) : Math.min(width, (height * 9) / 16);
    const outHeight = shape === 'circle' ? outWidth : Math.min(height, (outWidth * 16) / 9);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(outWidth);
    canvas.height = Math.round(outHeight);
    const context = canvas.getContext('2d');
    if (!context) return;

    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(
      element,
      (width - outWidth) / 2,
      (height - outHeight) / 2,
      outWidth,
      outHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.9);
  }

  if (state === 'denied' || state === 'unavailable') {
    return (
      <p className="rounded-lg border border-line bg-raised px-4 py-5 text-sm leading-relaxed text-muted">
        {state === 'denied'
          ? 'Camera access was turned down. You can allow it in your browser settings, or upload a photo instead.'
          : shape === 'circle'
            ? 'No camera is available here. Upload a photo or pick a pattern instead.'
            : 'No camera is available here. Choose a photo instead.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <div
        className={`relative overflow-hidden bg-raised ring-1 ring-line ${
          shape === 'circle'
            ? 'h-56 w-56 rounded-full'
            : 'aspect-[9/16] h-[min(52dvh,26rem)] rounded-2xl'
        }`}
      >
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label="Camera preview"
          className="h-full w-full -scale-x-100 object-cover"
        />
        {state === 'starting' ? (
          <span className="absolute inset-0 grid place-items-center text-sm text-faint">
            Starting the camera…
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={capture}
        disabled={state !== 'live' || busy}
        className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-contrast transition-[background-color,transform] duration-200 hover:bg-accent-hover active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Take the picture'}
      </button>
    </div>
  );
}
