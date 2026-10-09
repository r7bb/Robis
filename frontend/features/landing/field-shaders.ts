/**
 * The point field's shaders.
 *
 * Two rules the source follows, each learnt by the field silently rendering
 * nothing:
 *
 * - Squares are written out by hand. `pow` with a negative base is undefined
 *   in GLSL, and the NaN some drivers return takes every point off the
 *   screen.
 * - Values the fragment shader needs (offline, column membership) arrive as
 *   varyings, not as uniforms declared in both stages. A uniform shared by
 *   both must have the same precision in each, and WebGL 1 refuses to link
 *   highp in one and mediump in the other.
 *
 * `uTime` is a phase, not a clock: the render loop advances it by elapsed
 * time multiplied by the current mode's speed. Scaling a raw clock instead
 * would make the whole surface jump whenever the speed changed.
 */

export const VERTEX = `
attribute vec2 aGrid;
uniform float uTime;
uniform float uAspect;
uniform float uOffline;
uniform float uColumns;
uniform float uMerge;
uniform float uPulse;
uniform float uDpr;
uniform float uActivity;
uniform vec2 uMouse;
varying float vGlow;
varying float vDepth;
varying float vOffline;
varying float vColumn;

void main() {
  vec2 g = aGrid;
  float t = uTime * 0.35;
  float wave = sin(g.x * 3.2 + t * 1.7) * cos(g.y * 4.1 - t * 1.3) * 0.5
             + sin((g.x + g.y) * 6.0 + t * 2.3) * 0.18;

  vec2 d = (g - uMouse) * vec2(1.0, 0.6);
  float ripple = exp(-dot(d, d) * 9.0) * 0.9 * (1.0 - uOffline);

  float r = length(g * vec2(1.0, 0.7));
  float k = (r - uPulse * 1.1) * 7.0;
  float ring = exp(-k * k) * exp(-uPulse * 1.2);

  // Sync: crests start at both edges and travel inwards to meet.
  float ax = abs(g.x);
  float merge = sin(ax * 9.0 + t * 6.0) * 0.4 * (1.0 - ax * 0.4) * uMerge;

  // Boards: four lanes with gutters between them.
  float lane = fract((g.x + 1.0) * 2.0);
  float inLane = smoothstep(0.0, 0.05, lane) * (1.0 - smoothstep(0.78, 0.84, lane));
  float column = mix(1.0, inLane, uColumns);

  float h = wave * mix(1.0, 0.25, uOffline) * (1.0 + uActivity * 0.7) * mix(1.0, 0.45, uColumns)
          + ripple + ring * 1.2 + merge + inLane * uColumns * 0.18;

  float depth = (g.y + 1.0) * 0.5;
  float z = mix(6.0, 1.05, depth);
  vec3 w = vec3(g.x * 3.6, h * 0.22 - 0.9, z);

  gl_Position = vec4(w.x / (w.z * uAspect) * 1.6, w.y / w.z * 1.6 + 0.42, 0.0, 1.0);
  gl_PointSize = 9.0 / w.z * uDpr * (1.0 + ripple * 0.8 + ring);
  vGlow = clamp(h * 0.8 + ripple + ring + uActivity * 0.35 + abs(merge), 0.0, 1.5);
  vDepth = depth;
  vOffline = uOffline;
  vColumn = column;
}`;

export const FRAGMENT = `
precision mediump float;
uniform vec3 uAccent;
varying float vGlow;
varying float vDepth;
varying float vOffline;
varying float vColumn;

void main() {
  float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  vec3 hot = mix(uAccent, vec3(1.0), 0.45);
  vec3 grey = vec3(0.45, 0.48, 0.55);
  vec3 colour = mix(mix(uAccent, hot, clamp(vGlow, 0.0, 1.0)), grey, vOffline * 0.85);
  float alpha = a * mix(0.42, 1.0, vDepth) * (0.5 + 0.5 * clamp(vGlow, 0.0, 1.0))
              * mix(1.0, 0.5, vOffline) * vColumn;
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

export function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
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
