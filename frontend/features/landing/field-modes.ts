/**
 * What each letter of the name does to the field behind it.
 *
 * R-O-B-I-S is read as five things the product does, and as each letter
 * takes its turn the surface acts that thing out. These are targets, not
 * keyframes: the render loop eases every value towards the current mode's
 * target, so moving between letters is a blend rather than a cut.
 *
 * Kept pure so `tests/landing-field` can hold each formation to its
 * meaning. Only "offline" greys the surface; only "board" splits it.
 */

export type FieldMode = 'idle' | 'realtime' | 'offline' | 'board' | 'once' | 'merge';

export type FieldTargets = {
  /** Multiplier on how fast the surface moves. */
  speed: number;
  /** 0 to 1: flattened, slowed and greyed out. */
  offline: number;
  /** 0 to 1: split into the four columns of a board. */
  columns: number;
  /** 0 to 1: waves arriving from both sides and meeting in the middle. */
  merge: number;
  /** A single ring sent out again and again, landing the same each time. */
  repeatRing: boolean;
};

export const FIELD_MODES: Record<FieldMode, FieldTargets> = {
  idle: { speed: 1, offline: 0, columns: 0, merge: 0, repeatRing: false },
  // Realtime: the same surface, just faster. Every change on its way out.
  realtime: { speed: 2.8, offline: 0, columns: 0, merge: 0, repeatRing: false },
  // Offline: what the demo does when the network is cut.
  offline: { speed: 0.15, offline: 1, columns: 0, merge: 0, repeatRing: false },
  // Boards: four lanes, like the columns of the issue board.
  board: { speed: 0.8, offline: 0, columns: 1, merge: 0, repeatRing: false },
  // Idempotent: one ring, sent again and again, and each lands exactly once.
  once: { speed: 0.6, offline: 0, columns: 0, merge: 0, repeatRing: true },
  // Sync: two people's edits, coming in from either side and meeting.
  merge: { speed: 1, offline: 0, columns: 0, merge: 1, repeatRing: false },
};

/** How often the idempotent step resends its ring, in seconds. */
export const RING_REPEAT_SECONDS = 1.8;

const LETTER_MODES: Record<string, FieldMode> = {
  R: 'realtime',
  O: 'offline',
  B: 'board',
  I: 'once',
  S: 'merge',
};

export function modeForLetter(letter: string | null): FieldMode {
  return (letter && LETTER_MODES[letter]) || 'idle';
}

/** One step of an ease towards `target`. A rate of 1 lands at once. */
export function approach(current: number, target: number, rate: number): number {
  return current + (target - current) * rate;
}

/** The surface as the shader sees it on one frame. */
export type SurfaceState = {
  /** Integrated time. Advanced by speed, so a speed change never jumps. */
  phase: number;
  speed: number;
  offline: number;
  columns: number;
  merge: number;
};

/**
 * One frame's step towards the current mode, as a new state.
 *
 * `rate` is the easing per frame (1 under reduced motion, so changes land at
 * once) and `elapsed` is in seconds (0 under reduced motion, so the surface
 * holds still).
 */
export function stepSurface(
  state: SurfaceState,
  targets: FieldTargets,
  rate: number,
  elapsed: number,
): SurfaceState {
  const speed = approach(state.speed, targets.speed, rate);
  return {
    phase: state.phase + elapsed * speed,
    speed,
    offline: approach(state.offline, targets.offline, rate),
    columns: approach(state.columns, targets.columns, rate),
    merge: approach(state.merge, targets.merge, rate),
  };
}

/** Far enough along that a ring has faded to nothing. */
const SPENT_RING_SECONDS = 9.6;

/**
 * How old the ring on screen is, in seconds.
 *
 * Normally that is the time since the last merge. On the idempotent step
 * the ring repeats on its own cycle instead, which reduced motion skips
 * entirely (`motion` is 0 there) rather than flashing a frozen ring.
 */
export function ringAge(now: number, pulseAt: number, repeat: boolean, motion: number): number {
  if (repeat) {
    return motion ? (now / 1000) % RING_REPEAT_SECONDS : SPENT_RING_SECONDS;
  }
  return Math.min((now - pulseAt) / 1000, SPENT_RING_SECONDS);
}
