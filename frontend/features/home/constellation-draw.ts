import { nodeRadius, type Point, sparkPoint } from './constellation-scene.ts';

/**
 * Drawing the constellation (`constellation.tsx`), one small function per
 * part, each reading the same frame description.
 */

export type StarNode = {
  id: string;
  name: string;
  /** Its theme's accent, as `r g b`. */
  accent: string;
  open: number;
  members: number;
  /** Everyone else connected to it right now. */
  present: readonly string[];
};

export type Spark = { workspaceId: string; actorId: string; born: number };
export type Bloom = { workspaceId: string; born: number };
export type Placed = { node: StarNode; x: number; y: number; r: number; index: number };

export type Frame = {
  ctx: CanvasRenderingContext2D;
  t: number;
  w: number;
  offline: boolean;
  font: string;
  pointer: Point | null;
};

export const SPARK_MS = 1100;
export const BLOOM_MS = 900;
const GREY = '148 163 184';

function colourOf(frame: Frame, node: StarNode): string {
  return frame.offline ? GREY : node.accent;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Where the `j`th person here circles a workspace at time `t`. */
export function presentAt(p: Placed, j: number, t: number): Point {
  const count = p.node.present.length;
  const angle = t * 0.0008 * (1 + j * 0.12) + (j * Math.PI * 2) / Math.max(1, count);
  return { x: p.x + Math.cos(angle) * p.r * 2.4, y: p.y + Math.sin(angle) * p.r * 2.4 };
}

/** The dashed lines that make it a constellation, drifting along. */
export function drawLines(frame: Frame, placed: readonly Placed[]) {
  if (placed.length < 2) return;
  const { ctx, t } = frame;
  ctx.setLineDash([2, 7]);
  ctx.lineDashOffset = -t * 0.012;
  ctx.strokeStyle = 'rgb(226 232 240 / 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const p of placed) {
    if (p.index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function isHovered(frame: Frame, p: Placed): boolean {
  const at = frame.pointer;
  return !!at && Math.hypot(at.x - p.x, at.y - p.y) < p.r * 2.2;
}

/** A workspace: its glow, its body, and its name when hovered. */
export function drawNode(frame: Frame, p: Placed) {
  const { ctx } = frame;
  const c = colourOf(frame, p.node);
  const hovered = isHovered(frame, p);
  const r = hovered ? p.r * 1.12 : p.r;

  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.4);
  glow.addColorStop(0, `rgb(${c} / 0.38)`);
  glow.addColorStop(1, `rgb(${c} / 0)`);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2);
  ctx.fill();

  dot(ctx, p.x, p.y, r, `rgb(${c})`);
  dot(ctx, p.x - r * 0.3, p.y - r * 0.32, r * 0.32, 'rgb(255 255 255 / 0.35)');

  if (hovered) {
    ctx.font = `500 12px ${frame.font}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgb(226 232 240 / 0.92)';
    ctx.fillText(p.node.name, p.x, p.y - r - 14);
  }
}

/** Members as quiet satellites; those here now circle it, brighter. */
export function drawPeople(frame: Frame, p: Placed) {
  const { ctx, t } = frame;
  const quiet = Math.min(p.node.members, 10);
  for (let j = 0; j < quiet; j++) {
    const angle = (j / quiet) * Math.PI * 2 + p.index;
    const x = p.x + Math.cos(angle) * p.r * 1.8;
    const y = p.y + Math.sin(angle) * p.r * 1.8;
    dot(ctx, x, y, 1.5, 'rgb(226 232 240 / 0.22)');
  }
  if (frame.offline) return;
  const c = colourOf(frame, p.node);
  for (let j = 0; j < p.node.present.length; j++) {
    const at = presentAt(p, j, t);
    dot(ctx, at.x, at.y, 6, `rgb(${c} / 0.25)`);
    dot(ctx, at.x, at.y, 2.6, 'rgb(248 250 252)');
  }
}

/**
 * Sparks on their way, each with a fading tail, from the person who made
 * the change if they are here, else from the sky. Returns the ones still
 * travelling and the blooms for those that arrived.
 */
export function drawSparks(
  frame: Frame,
  placed: readonly Placed[],
  sparks: readonly Spark[],
): { travelling: Spark[]; arrived: Bloom[] } {
  const { ctx, t, w } = frame;
  const travelling: Spark[] = [];
  const arrived: Bloom[] = [];
  for (const s of sparks) {
    const target = placed.find((p) => p.node.id === s.workspaceId);
    if (!target) continue;
    const progress = (t - s.born) / SPARK_MS;
    if (progress >= 1) {
      arrived.push({ workspaceId: s.workspaceId, born: t });
      continue;
    }
    travelling.push(s);
    const who = target.node.present.indexOf(s.actorId);
    const from = who >= 0 ? presentAt(target, who, s.born) : { x: target.x - w * 0.25, y: -20 };
    const c = colourOf(frame, target.node);
    for (let k = 8; k >= 0; k--) {
      const at = sparkPoint(from, target, Math.max(0, progress - k * 0.035));
      const alpha = ((1 - k / 9) * 0.8).toFixed(2);
      dot(ctx, at.x, at.y, k === 0 ? 3.2 : 2.2 - k * 0.15, `rgb(${c} / ${alpha})`);
    }
  }
  return { travelling, arrived };
}

/** A ring that widens and fades where a spark landed. Returns those still showing. */
export function drawBlooms(frame: Frame, placed: readonly Placed[], blooms: readonly Bloom[]) {
  const { ctx, t } = frame;
  const showing = blooms.filter((b) => t - b.born < BLOOM_MS);
  for (const b of showing) {
    const target = placed.find((p) => p.node.id === b.workspaceId);
    if (!target) continue;
    const k = (t - b.born) / BLOOM_MS;
    ctx.strokeStyle = `rgb(${colourOf(frame, target.node)} / ${(1 - k).toFixed(2)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r * (1 + k * 3), 0, Math.PI * 2);
    ctx.stroke();
  }
  return showing;
}

/** Each workspace's place this frame: its spot, the lean, and a slow bob. */
export function placeNodes(
  nodes: readonly StarNode[],
  spots: readonly Point[],
  size: { w: number; h: number },
  lean: Point,
  t: number,
): Placed[] {
  return nodes.map((node, index) => ({
    node,
    index,
    x: spots[index]!.x * size.w + lean.x,
    y: spots[index]!.y * size.h + lean.y + Math.sin(t * 0.0006 + index * 1.7) * 5,
    r: nodeRadius(node.open),
  }));
}
