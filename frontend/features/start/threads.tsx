'use client';

import { useEffect, useRef } from 'react';

/**
 * The intro's own background: a loom of slow threads.
 *
 * Not the landing page's dot field. Each thread is a long curve, the sum of
 * a few sine waves with its own phase, drifting sideways like a strand in
 * water; together they read as work in progress, many lines running side
 * by side. The pointer parts them gently. Each slide has its own tint, and
 * while the tunnel slide is offline the threads slow and dim.
 *
 * 2D canvas, so nothing to compile and nothing that can fail to link. It
 * pauses when hidden or off screen, caps the pixel ratio, and under
 * reduced motion draws one still frame per change and ignores the pointer.
 */

export type ThreadsTint = readonly [number, number, number];

const THREADS = 34;
const SEGMENTS = 90;
const MAX_DPR = 2;
/** How quickly the tint and the calm ease towards their targets, per second. */
const EASE_PER_SECOND = 2.4;

type Pointer = { x: number; y: number; active: boolean };

function threadY(
  thread: number,
  u: number,
  height: number,
  time: number,
): { y: number; weight: number } {
  const share = thread / (THREADS - 1);
  const base = height * (0.18 + share * 0.74);
  const phase = thread * 1.73;
  const swing = height * (0.05 + 0.04 * Math.sin(thread * 0.7));
  const y =
    base +
    Math.sin(u * 5.1 + time * 0.31 + phase) * swing +
    Math.sin(u * 11.3 - time * 0.19 + phase * 0.6) * swing * 0.35 +
    Math.sin(u * 2.2 + time * 0.11 + thread) * height * 0.03;
  // Middle threads brightest, so the loom has a body rather than edges.
  return { y, weight: 0.25 + 0.75 * Math.sin(share * Math.PI) };
}

/** Threads near the pointer are pushed away from it along y. */
function parted(x: number, y: number, pointer: Pointer, reach: number): number {
  if (!pointer.active) return y;
  const dx = x - pointer.x;
  const dy = y - pointer.y;
  const near = Math.exp(-(dx * dx + dy * dy) / (2 * reach * reach));
  return y + Math.sign(dy || 1) * near * reach * 0.45;
}

function draw(
  context: CanvasRenderingContext2D,
  size: { width: number; height: number },
  time: number,
  tint: ThreadsTint,
  calm: number,
  pointer: Pointer,
) {
  const { width, height } = size;
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'lighter';
  const brightness = 1 - calm * 0.6;
  const reach = Math.min(width, height) * 0.22;

  for (let thread = 0; thread < THREADS; thread++) {
    let weight = 0;
    context.beginPath();
    for (let step = 0; step <= SEGMENTS; step++) {
      const x = (step / SEGMENTS) * width;
      const point = threadY(thread, x / width, height, time);
      weight = point.weight;
      const y = parted(x, point.y, pointer, reach);
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    const alpha = (0.06 + 0.16 * weight) * brightness;
    context.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha.toFixed(3)})`;
    context.lineWidth = 1 + weight * 0.6;
    context.stroke();
  }
  context.globalCompositeOperation = 'source-over';
}

export function Threads({ tint, calm }: { tint: ThreadsTint; calm: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Targets read by the loop each frame, without React rendering per frame.
  const target = useRef({ tint, calm });
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    target.current = { tint, calm };
    redraw.current();
  }, [tint, calm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const pointer: Pointer = { x: 0, y: 0, active: false };
    let shown = [...target.current.tint] as [number, number, number];
    let calmness = target.current.calm ? 1 : 0;
    let time = 0;
    let last = performance.now();
    let frame = 0;
    let visible = true;
    // Measured on resize and scroll, not read on every frame or pointer move.
    let size = { width: canvas.clientWidth, height: canvas.clientHeight };
    let box = canvas.getBoundingClientRect();

    const paint = (now: number) => {
      const seconds = Math.min((now - last) / 1000, 0.1);
      last = now;
      const blend = reduced ? 1 : 1 - Math.exp(-EASE_PER_SECOND * seconds);
      const goal = target.current;
      shown = shown.map((value, i) => value + (goal.tint[i]! - value) * blend) as typeof shown;
      calmness += ((goal.calm ? 1 : 0) - calmness) * blend;
      if (!reduced) time += seconds * (1 - calmness * 0.8);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(context, size, time, shown, calmness, pointer);
    };

    const loop = (now: number) => {
      paint(now);
      frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };

    const start = () => {
      if (reduced) {
        paint(performance.now());
        return;
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(loop);
      }
    };
    redraw.current = start;

    const measure = () => {
      box = canvas.getBoundingClientRect();
    };
    const resize = new ResizeObserver(() => {
      size = { width: canvas.clientWidth, height: canvas.clientHeight };
      canvas.width = Math.round(size.width * dpr);
      canvas.height = Math.round(size.height * dpr);
      measure();
      start();
    });
    resize.observe(canvas);

    const seen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
    });
    seen.observe(canvas);

    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX - box.left;
      pointer.y = event.clientY - box.top;
      pointer.active = true;
    };
    // Out of the window, or a finger lifted: the threads close up again.
    const onOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) pointer.active = false;
    };
    const onLift = (event: PointerEvent) => {
      if (event.pointerType === 'touch') pointer.active = false;
    };
    const onVisibility = () => {
      if (!document.hidden) start();
    };

    // Parting is motion too, so under reduced motion the pointer is ignored.
    if (!reduced) {
      window.addEventListener('pointermove', onPointer, { passive: true });
      document.addEventListener('pointerout', onOut);
      window.addEventListener('pointerup', onLift);
      window.addEventListener('pointercancel', onLift);
    }
    window.addEventListener('scroll', measure, { passive: true, capture: true });
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      seen.disconnect();
      window.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerout', onOut);
      window.removeEventListener('pointerup', onLift);
      window.removeEventListener('pointercancel', onLift);
      window.removeEventListener('scroll', measure, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      redraw.current = () => {};
    };
  }, []);

  // Decorative: the intro hides the layer this sits in from assistive tech.
  return <canvas ref={canvasRef} className="block h-full w-full" />;
}
