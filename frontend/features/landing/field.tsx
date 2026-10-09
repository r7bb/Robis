'use client';

import { type RefObject, useEffect, useRef, useState } from 'react';
import {
  FIELD_MODES,
  type FieldMode,
  ringAge,
  type SurfaceState,
  stepSurface,
} from './field-modes.ts';
import { compile, FRAGMENT, VERTEX } from './field-shaders.ts';

/**
 * A live field of points behind the hero, drawn with raw WebGL.
 *
 * It is not decoration for its own sake: it acts out whatever the page is
 * talking about. As each letter of the name takes its turn the surface takes
 * that letter's formation (`field-modes.ts`): faster for realtime, grey and
 * flat for offline, four lanes for the board, one repeated ring for
 * idempotent, two converging fronts for sync. Further down it mirrors the
 * live demo: cut the network and it greys, type and it swells, merge and a
 * ring goes out.
 *
 * Raw WebGL rather than Three.js. One draw call of points with the work in
 * the vertex shader, and a 3D engine would add roughly 150 KB to the
 * landing page for the same picture.
 *
 * Cheap by construction: it renders only while on screen and the tab is
 * visible, caps the pixel ratio, and under `prefers-reduced-motion` draws
 * still frames only. Without WebGL it renders nothing and the band's own
 * background shows through.
 */

const COLS = 140;
const ROWS = 70;
const MAX_DPR = 1.5;
/** How fast a keystroke's swell dies away, in milliseconds per e-fold. */
const ACTIVITY_DECAY_MS = 320;
/**
 * How quickly the surface blends from one formation to the next, per
 * second. Applied as `1 - e^(-rate * elapsed)` rather than a fixed fraction
 * per frame, so a 120 Hz screen blends at the same pace as a 60 Hz one.
 */
const MODE_BLEND_PER_SECOND = 3;
/** Per-frame easing of the cursor ripple towards the pointer. */
const POINTER_EASE = 0.08;

/** The page's accent token, so the field never drifts off the palette. */
function accentColour(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return [0.39, 0.4, 0.95];
  return [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255];
}

/** 1 at a keystroke, decaying towards 0. */
function activitySwell(now: number, activityAt: number): number {
  return Math.exp(-(now - activityAt) / ACTIVITY_DECAY_MS);
}

function gridPoints(): Float32Array {
  const points = new Float32Array(COLS * ROWS * 2);
  let i = 0;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      points[i++] = (col / (COLS - 1)) * 2 - 1;
      points[i++] = (row / (ROWS - 1)) * 2 - 1;
    }
  }
  return points;
}

function linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;

  console.warn('[field] shaders did not link:', gl.getProgramInfoLog(program));
  return null;
}

export function Field({
  mode,
  pulse,
  activityAt,
  className = '',
}: {
  mode: FieldMode;
  /** Bumped on every merge; each change sends one ring out. */
  pulse: number;
  /**
   * When the last keystroke happened, as `performance.now()`. A ref rather
   * than a prop value: keystrokes arrive every few dozen milliseconds, and
   * the render loop reads this each frame without React rendering at all.
   */
  activityAt?: RefObject<number>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /*
   * Bumped when the browser hands a lost WebGL context back. Mobile
   * browsers reclaim contexts from background tabs, and a canvas whose
   * context was lost cannot be revived in place, so a fresh canvas is
   * mounted (it is the React key) and the effect builds everything again.
   */
  const [generation, setGeneration] = useState(0);
  // Read by the render loop. Refs, not state: the loop runs every frame and
  // must never cause a React render.
  const live = useRef({ mode, pulseAt: Number.NEGATIVE_INFINITY, redraw: () => {} });

  useEffect(() => {
    live.current.mode = mode;
    live.current.redraw();
  }, [mode]);

  useEffect(() => {
    if (pulse > 0) live.current.pulseAt = performance.now();
  }, [pulse]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the canvas's key; a new value means a new canvas element, and this effect must rebuild on it. `activityAt` is a ref object that never changes identity.
  useEffect(() => {
    const canvas = canvasRef.current;
    // The content sits above the canvas, so pointer events bubble to the
    // section rather than to the canvas or its wrapper.
    const host = canvas?.closest('section');
    const gl = canvas?.getContext('webgl', { antialias: false, premultipliedAlpha: true });
    if (!canvas || !host || !gl) return;

    const program = linkProgram(gl);
    if (!program) return;
    // biome-ignore lint/correctness/useHookAtTopLevel: `useProgram` is a WebGL call, not a React hook; the rule matches on the `use` prefix.
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, gridPoints(), gl.STATIC_DRAW);
    const aGrid = gl.getAttribLocation(program, 'aGrid');
    gl.enableVertexAttribArray(aGrid);
    gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);

    const at = (name: string) => gl.getUniformLocation(program, name);
    const u = {
      time: at('uTime'),
      aspect: at('uAspect'),
      offline: at('uOffline'),
      columns: at('uColumns'),
      merge: at('uMerge'),
      pulse: at('uPulse'),
      dpr: at('uDpr'),
      activity: at('uActivity'),
      mouse: at('uMouse'),
    };
    gl.uniform3fv(at('uAccent'), accentColour());
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    // Decided once rather than per frame: under reduced motion time stands
    // still, swells and repeating rings are off, and formations land at once.
    const motion = reduced ? 0 : 1;

    const first = FIELD_MODES[live.current.mode];
    let surface: SurfaceState = {
      phase: 0,
      speed: first.speed,
      offline: first.offline,
      columns: first.columns,
      merge: first.merge,
    };
    const mouse = { x: 0, y: 2, tx: 0, ty: 2 };
    let last = performance.now();
    let frame = 0;
    let visible = true;

    function draw(now: number) {
      if (!canvas || !gl) return;
      const targets = FIELD_MODES[live.current.mode];
      // Clamped, so a tab returning from the background does not lurch the
      // phase forward by however long it was away.
      const seconds = Math.min((now - last) / 1000, 0.1);
      last = now;
      // Under reduced motion formations land at once and the phase holds.
      const blend = reduced ? 1 : 1 - Math.exp(-MODE_BLEND_PER_SECOND * seconds);
      surface = stepSurface(surface, targets, blend, seconds * motion);
      mouse.x += (mouse.tx - mouse.x) * POINTER_EASE;
      mouse.y += (mouse.ty - mouse.y) * POINTER_EASE;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.time, surface.phase);
      gl.uniform1f(u.aspect, canvas.width / Math.max(canvas.height, 1));
      gl.uniform1f(u.offline, surface.offline);
      gl.uniform1f(u.columns, surface.columns);
      gl.uniform1f(u.merge, surface.merge);
      gl.uniform1f(u.pulse, ringAge(now, live.current.pulseAt, targets.repeatRing, motion));
      gl.uniform1f(u.dpr, dpr);
      gl.uniform1f(
        u.activity,
        motion * activitySwell(now, activityAt?.current ?? Number.NEGATIVE_INFINITY),
      );
      gl.uniform2f(u.mouse, mouse.x, mouse.y);
      gl.drawArrays(gl.POINTS, 0, COLS * ROWS);
    }

    function loop(now: number) {
      draw(now);
      frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    }

    function start() {
      if (reduced) {
        draw(performance.now());
        return;
      }
      if (!frame) {
        // Restarting after a pause: measure the next frame from now, not
        // from whenever the loop last ran.
        last = performance.now();
        frame = requestAnimationFrame(loop);
      }
    }

    live.current.redraw = () => start();

    const resize = new ResizeObserver(() => {
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      start();
    });
    resize.observe(canvas);

    const seen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) start();
    });
    seen.observe(canvas);

    const onVisibility = () => {
      if (!document.hidden) start();
    };

    // The cursor's position in the field's own coordinates: x across, y as
    // depth, so the ripple sits under the pointer rather than at its screen
    // height.
    const onPointer = (event: PointerEvent) => {
      const box = canvas.getBoundingClientRect();
      mouse.tx = ((event.clientX - box.left) / box.width) * 2 - 1;
      const depth = ((event.clientY - box.top) / box.height - 0.35) / 0.65;
      mouse.ty = Math.min(Math.max(depth, 0), 1) * 2 - 1;
    };
    const onLeave = () => {
      mouse.ty = 2;
    };

    const onLost = (event: Event) => {
      // Without `preventDefault` the browser will never offer it back.
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onRestored = () => setGeneration((count) => count + 1);

    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    document.addEventListener('visibilitychange', onVisibility);
    host.addEventListener('pointermove', onPointer);
    host.addEventListener('pointerleave', onLeave);
    start();

    return () => {
      cancelAnimationFrame(frame);
      frame = 0;
      live.current.redraw = () => {};
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      host.removeEventListener('pointermove', onPointer);
      host.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // The context is not force-lost here. Under StrictMode the effect runs
      // twice on the same canvas, and a context lost on the first cleanup is
      // the one the second run gets back, which leaves the field blank.
    };
  }, [generation, activityAt]);

  return (
    // Hidden from assistive technology by the caller's wrapper, which is
    // `aria-hidden` along with the gradient laid over it.
    <canvas
      key={generation}
      ref={canvasRef}
      className={`pointer-events-none block h-full w-full ${className}`}
    />
  );
}
