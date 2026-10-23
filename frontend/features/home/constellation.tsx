'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../landing/use-scroll.ts';
import {
  type Bloom,
  drawBlooms,
  drawLines,
  drawNode,
  drawPeople,
  drawSparks,
  type Frame,
  placeNodes,
  SPARK_MS,
  type Spark,
  type StarNode,
} from './constellation-draw.ts';
import { layoutNodes, type Point } from './constellation-scene.ts';

export type { StarNode } from './constellation-draw.ts';

/** The latest live event: `seq` goes up by one each time. */
export type SparkSignal = { workspaceId: string; actorId: string; seq: number };

/** Below this the greeting spans the hero, so the sky moves under it (`home-hero.tsx`). */
const NARROW_PX = 1024;
/** How far the scene leans away from the pointer. */
const PARALLAX = 0.014;
/** Sparks in flight at once; a burst beyond this is one bright moment, not a queue. */
const MAX_SPARKS = 12;

/**
 * Run `draw` every frame while the canvas is on screen and the tab is
 * visible; under reduced motion, never (the caller draws stills). Returns
 * the cleanup.
 */
function runLoop(canvas: HTMLCanvasElement, draw: (t: number) => void, reduced: boolean) {
  let frame = 0;
  let onScreen = true;
  const loop = (t: number) => {
    draw(t);
    frame = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!reduced && !frame && onScreen && document.visibilityState === 'visible') {
      frame = requestAnimationFrame(loop);
    }
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const watcher = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? true;
    if (onScreen) start();
    else stop();
  });
  watcher.observe(canvas);
  const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
  document.addEventListener('visibilitychange', onVisibility);
  start();
  return () => {
    stop();
    watcher.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

/**
 * The home's own picture: your workspaces as a constellation, each a node
 * in its theme's colour, sized by what is open. Teammates who are here
 * circle the workspace they are in; a live event sends a spark from the
 * person who made it to their workspace, which blooms. Lines between the
 * nodes drift, the scene leans with the pointer, and hovering a node names
 * it. Offline, it greys and stills. Drawing is in `constellation-draw.ts`.
 *
 * Canvas 2D rather than WebGL: a few dozen shapes, not thousands of points.
 * Drawn only while on screen and the tab is visible, at a capped pixel
 * ratio; under reduced motion it draws one still frame and redraws only
 * when the data or the pointer changes. Decorative: the hero's text says
 * the same in words.
 */
export function Constellation({
  nodes,
  spark,
  offline,
}: {
  nodes: readonly StarNode[];
  spark: SparkSignal | null;
  offline: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const data = useRef({ nodes, offline });
  data.current = { nodes, offline };
  const sparks = useRef<Spark[]>([]);
  const blooms = useRef<Bloom[]>([]);
  const pointer = useRef<Point | null>(null);
  const still = useRef<() => void>(() => {});

  useEffect(() => {
    // Nobody is watching a hidden tab, and the loop is paused, so nothing
    // would prune them: skip, and keep only a few recent ones in flight.
    if (!spark || reduced || document.visibilityState !== 'visible') return;
    const now = performance.now();
    sparks.current = [
      ...sparks.current.filter((s) => now - s.born < SPARK_MS),
      { ...spark, born: now },
    ].slice(-MAX_SPARKS);
  }, [spark, reduced]);

  // Under reduced motion there is no loop, so new data redraws the still.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `nodes` and `offline` are the triggers; the drawing reads them from a ref
  useEffect(() => {
    if (reduced) still.current();
  }, [nodes, offline, reduced]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const host = canvas.parentElement?.parentElement ?? canvas;
    const font = getComputedStyle(document.body).fontFamily;
    const size = { w: 0, h: 0 };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, size.w, size.h);
      const { nodes: list, offline: grey } = data.current;
      const at = pointer.current;
      // No lean under reduced motion: the scene stays where it is.
      const lean =
        at && !reduced
          ? { x: (at.x - size.w / 2) * -PARALLAX, y: (at.y - size.h / 2) * -PARALLAX }
          : { x: 0, y: 0 };
      const placed = placeNodes(list, layoutNodes(list.length, size.w < NARROW_PX), size, lean, t);
      const frame: Frame = { ctx, t, w: size.w, offline: grey, font, pointer: at };
      drawLines(frame, placed);
      for (const p of placed) {
        drawNode(frame, p);
        drawPeople(frame, p);
      }
      const { travelling, arrived } = drawSparks(frame, placed, sparks.current);
      sparks.current = travelling;
      blooms.current = drawBlooms(frame, placed, [...blooms.current, ...arrived]);
    };
    still.current = () => draw(0);

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.w = canvas.clientWidth;
      size.h = canvas.clientHeight;
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduced) draw(0);
    };
    const resizer = new ResizeObserver(resize);
    resizer.observe(canvas);
    resize();

    const onMove = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      pointer.current = { x: event.clientX - box.left, y: event.clientY - box.top };
      if (reduced) draw(0);
    };
    const onLeave = () => {
      pointer.current = null;
      if (reduced) draw(0);
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);

    const stopLoop = runLoop(canvas, draw, reduced);
    return () => {
      stopLoop();
      resizer.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
    };
  }, [reduced]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
