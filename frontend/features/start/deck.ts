import { PASSWORD_MIN_LENGTH } from '@robis/shared';

/**
 * The "Get started" intro, as data.
 *
 * Short on purpose: five slides, each one idea and one thing to touch,
 * ending on the way in. Kept pure so `tests/start-intro.test.ts` holds the
 * copy to its own rules (short titles, a name for every slide, no dashes)
 * and the navigation to its edges.
 */

/** Where the intro hands over: the form opens on "Create account". */
export const SIGN_UP_HREF = '/login?mode=register';

export type SlideId = 'hello' | 'offline' | 'record' | 'needs' | 'start';

export type Slide = {
  id: SlideId;
  /** What a screen reader announces for the slide, and the picker's label. */
  label: string;
  title: string;
  body: string;
};

export const SLIDES: readonly Slide[] = [
  {
    id: 'hello',
    label: 'What Robis is',
    title: 'Plan the work together. Even on a train.',
    body: 'An issue tracker for small teams: boards, documents and chat, live for everyone, and still working when the network is not.',
  },
  {
    id: 'offline',
    label: 'Working offline',
    title: 'Turn the network off. Keep typing.',
    body: 'Two editors, as if on two devices. Switch the connection off, write in both, switch it back. Nothing is lost or doubled.',
  },
  {
    id: 'record',
    label: 'The record',
    title: 'Every change, on a record you can check.',
    body: 'Each event is hashed together with the one before it. Change any of them and the chain breaks exactly there. Try it.',
  },
  {
    id: 'needs',
    label: 'What you need',
    title: 'What it takes to begin.',
    body: 'No card, no download. A few details and a couple of minutes.',
  },
  {
    id: 'start',
    label: 'Get started',
    title: 'Ready when you are.',
    body: 'Create an account to start a workspace, or sign in to one you already have.',
  },
];

/** The "what you need" list, kept beside the slides it belongs to. */
export const NEEDS: readonly { what: string; why: string }[] = [
  {
    what: 'An email address',
    why: 'We send one link to confirm it, and one if you forget your password.',
  },
  {
    what: `A password of ${PASSWORD_MIN_LENGTH} characters or more`,
    why: 'Stored only as a slow, salted hash.',
  },
  { what: 'A picture, or a pattern', why: 'Chosen first, so teammates can tell who did what.' },
  { what: 'A workspace', why: 'Start your own, or open the one a teammate invited you to.' },
];

export function clampSlide(index: number): number {
  return Math.min(Math.max(index, 0), SLIDES.length - 1);
}

export type Step = 1 | -1 | 'first' | 'last';

/** What a key does to the deck, or null if it does nothing. */
export function stepForKey(key: string): Step | null {
  switch (key) {
    case 'ArrowRight':
    case 'PageDown':
    case ' ':
      return 1;
    case 'ArrowLeft':
    case 'PageUp':
      return -1;
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/** How far a drag must travel sideways before it counts as a swipe. */
export const SWIPE_MIN_PX = 48;

/**
 * Which way a finished drag turns the deck: 1 forward, -1 back, 0 neither.
 * Only a mostly horizontal drag counts, so scrolling a slide is never
 * mistaken for turning it.
 */
export function swipeStep(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
