'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A live field of points behind the hero, drawn with raw WebGL.
 *
 * It is not decoration for its own sake: it mirrors the demo in front of it.
 * Online, the surface moves and answers the cursor. Cut the network and it
 * slows, flattens and greys out. Reconnect and a ring travels out from the
 * centre as the two documents merge. Motion that reports state.
 *
 * Raw WebGL rather than Three.js. One draw call of points with the work in
 * the vertex shader is about a hundred lines, and a 3D engine would add
 * roughly 150 KB to the landing page for the same picture.
 *
 * Cheap by construction: it renders only while on screen and the tab is
 * visible, caps the pixel ratio, and under `prefers-reduced-motion` draws a
 * single still frame. Without WebGL it renders nothing and the band's own
 * background shows through.
 */

const COLS = 140;
const ROWS = 70;
const MAX_DPR = 1.5;
/** Seconds the merge ring takes to fade out. */
const PULSE_SECONDS = 2.4;

/*
 * Two rules the shaders below follow, each learnt by the field silently
 * rendering nothing:
 *
 * - The merge ring squares its distance by hand. `pow` with a negative base
 *   is undefined in GLSL, and the NaN some drivers return takes every point
 *   off the screen.
 * - The offline amount reaches the fragment shader as a varying, not as a
 *   second `uOffline` uniform. A uniform shared by both stages must have the
 *   same precision in each, and WebGL 1 refuses to link highp in one and
 *   mediump in the other.
 */
const VERTEX = `
attribute vec2 aGrid;
uniform float uTime;
uniform float uAspect;
uniform float uOffline;
uniform float uPulse;
uniform float uDpr;
uniform vec2 uMouse;
varying float vGlow;
varying float vDepth;
varying float vOffline;

void main() {
  vec2 g = aGrid;
  float t = uTime * mix(0.35, 0.05, uOffline);
  float wave = sin(g.x * 3.2 + t * 1.7) * cos(g.y * 4.1 - t * 1.3) * 0.5
             + sin((g.x + g.y) * 6.0 + t * 2.3) * 0.18;

  vec2 d = (g - uMouse) * vec2(1.0, 0.6);
  float ripple = exp(-dot(d, d) * 9.0) * 0.9 * (1.0 - uOffline);

  float r = length(g * vec2(1.0, 0.7));
  float k = (r - uPulse * 1.1) * 7.0;
  float ring = exp(-k * k) * exp(-uPulse * 1.2);

  float h = wave * mix(1.0, 0.25, uOffline) + ripple + ring * 1.2;

  float depth = (g.y + 1.0) * 0.5;
  float z = mix(6.0, 1.05, depth);
  vec3 w = vec3(g.x * 3.6, h * 0.22 - 0.9, z);

  gl_Position = vec4(w.x / (w.z * uAspect) * 1.6, w.y / w.z * 1.6 + 0.42, 0.0, 1.0);
  gl_PointSize = 7.5 / w.z * uDpr * (1.0 + ripple * 0.8 + ring);
  vGlow = clamp(h * 0.8 + ripple + ring, 0.0, 1.5);
  vDepth = depth;
  vOffline = uOffline;
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uAccent;
varying float vGlow;
varying float vDepth;
varying float vOffline;

void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  vec3 hot = mix(uAccent, vec3(1.0), 0.45);
  vec3 grey = vec3(0.45, 0.48, 0.55);
  vec3 colour = mix(mix(uAccent, hot, clamp(vGlow, 0.0, 1.0)), grey, vOffline * 0.85);
  float alpha = a * mix(0.22, 0.9, vDepth) * (0.5 + 0.5 * clamp(vGlow, 0.0, 1.0))
              * mix(1.0, 0.5, vOffline);
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

  // The page is fine without the field, so this degrades rather than
  // throwing. But a shader that fails to build is a bug, and the only way
  // anyone sees it is if it is said out loud.
  console.warn('[field] shader did not compile:', gl.getShaderInfoLog(shader));
  return null;
}

/** The page's accent token, so the field never drifts off the palette. */
function accentColour(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return [0.39, 0.4, 0.95];
  return [parts[0]! / 255, parts[1]! / 255, parts[2]! / 255];
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

export function Field({
  offline,
  pulse,
  className = '',
}: {
  offline: boolean;
  /** Bumped on every merge; each change sends one ring out. */
  pulse: number;
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
  const live = useRef({ offline, pulseAt: Number.NEGATIVE_INFINITY, redraw: () => {} });

  useEffect(() => {
    live.current.offline = offline;
    live.current.redraw();
  }, [offline]);

  useEffect(() => {
    if (pulse > 0) live.current.pulseAt = performance.now();
  }, [pulse]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is the canvas's key; a new value means a new canvas element, and this effect must rebuild on it.
  useEffect(() => {
    const canvas = canvasRef.current;
    // The content sits above the canvas, so pointer events bubble to the
    // section rather than to the canvas or its wrapper.
    const host = canvas?.closest('section');
    const gl = canvas?.getContext('webgl', { antialias: false, premultipliedAlpha: true });
    if (!canvas || !host || !gl) return;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[field] shaders did not link:', gl.getProgramInfoLog(program));
      return;
    }
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
      pulse: at('uPulse'),
      dpr: at('uDpr'),
      mouse: at('uMouse'),
      accent: at('uAccent'),
    };
    gl.uniform3fv(u.accent, accentColour());
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const started = performance.now();
    const mouse = { x: 0, y: 2, tx: 0, ty: 2 };
    let offlineMix = live.current.offline ? 1 : 0;
    let frame = 0;
    let visible = true;

    function draw(now: number) {
      if (!canvas || !gl) return;
      const target = live.current.offline ? 1 : 0;
      offlineMix = reduced ? target : offlineMix + (target - offlineMix) * 0.06;
      mouse.x += (mouse.tx - mouse.x) * 0.08;
      mouse.y += (mouse.ty - mouse.y) * 0.08;

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(u.time, reduced ? 0 : (now - started) / 1000);
      gl.uniform1f(u.aspect, canvas.width / Math.max(canvas.height, 1));
      gl.uniform1f(u.offline, offlineMix);
      gl.uniform1f(u.pulse, Math.min((now - live.current.pulseAt) / 1000, PULSE_SECONDS * 4));
      gl.uniform1f(u.dpr, dpr);
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
      if (!frame) frame = requestAnimationFrame(loop);
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
  }, [generation]);

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
