import { PASSWORD_MIN_LENGTH } from '@robis/shared';

/**
 * The "Get started" intro, as data.
 *
 * Its own story rather than the landing page again: two things to play
 * with (a messy desk to sort, a tunnel to work through) between quotes
 * about planning and teams, ending on the way in. Kept pure so
 * `tests/start-intro.test.ts` holds the copy to its rules and the gestures
 * to their edges.
 */

/** Where the intro hands over: the form opens on "Create account". */
export const SIGN_UP_HREF = '/login?mode=register';

export type SlideId = 'hello' | 'plans' | 'desk' | 'team' | 'tunnel' | 'start';

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
    label: 'Hello',
    title: 'For teams who would rather do the work.',
    body: 'Robis keeps track of what is planned, who has it, and what changed, so the tracking takes less of your day than the work.',
  },
  {
    id: 'plans',
    label: 'On planning',
    title: 'The plan will change. Plan anyway.',
    body: 'So a plan in Robis is cheap to change: drag a card, reword a goal, and everyone sees the new version at once.',
  },
  {
    id: 'desk',
    label: 'Sort the desk',
    title: 'Every team starts with a messy desk.',
    body: 'Tap a note to move it along. To do, doing, done: that is most of what a board is for.',
  },
  {
    id: 'team',
    label: 'On teams',
    title: 'More people is not the answer.',
    body: 'Robis is built for the people already on the team: mentions, threads and one shared board, with nothing new to learn first.',
  },
  {
    id: 'tunnel',
    label: 'Into the tunnel',
    title: 'Signal drops. Work does not.',
    body: 'Take the train into the tunnel, add a few notes, and come back out. They wait on your device, then go, in order.',
  },
  {
    id: 'start',
    label: 'Get started',
    title: 'Ready when you are.',
    body: 'No card, no download. A few details, a couple of minutes, and you are in.',
  },
];

export type Quote = { text: string; who: string; source: string };

/**
 * Quotes, each checked against where it was said. Hopper's is reported
 * speech, so it is given as the reporter gave it, not as her words.
 */
export const QUOTES = {
  hopper: {
    text: 'The most dangerous phrase a DP manager can use is “We’ve always done it that way.”',
    who: 'Grace Hopper, as reported',
    source: 'Computerworld, 26 January 1976',
  },
  plans: {
    text: 'Plans are worthless, but planning is everything.',
    who: 'Dwight D. Eisenhower',
    source: 'Remarks to the National Defense Executive Reserve Conference, 14 November 1957',
  },
  brooks: {
    text: 'Adding manpower to a late software project makes it later.',
    who: 'Fred Brooks',
    source: 'The Mythical Man-Month, 1975',
  },
} as const satisfies Record<string, Quote>;

/** The "what you need" list, kept beside the slides it belongs to. */
export const NEEDS: readonly { what: string; why: string }[] = [
  { what: 'An email address', why: 'One link to confirm it, and one if you forget your password.' },
  {
    what: `A password of ${PASSWORD_MIN_LENGTH}+ characters`,
    why: 'Stored only as a slow, salted hash.',
  },
  { what: 'A picture or a pattern', why: 'So teammates can tell who did what.' },
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
 * Which way a finished touch drag turns the deck: 1 forward, -1 back, 0
 * neither. Only a mostly horizontal drag counts, so scrolling a slide is
 * never mistaken for turning it.
 */
export function swipeStep(dx: number, dy: number): 1 | -1 | 0 {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

/** How much scrolling one turn takes. */
const WHEEL_TURN_PX = 60;
/** How quiet the wheel must go before a new gesture can begin. */
const WHEEL_QUIET_MS = 220;

export type ScrollRoom = { canScrollDown: boolean; canScrollUp: boolean };

/**
 * Two-finger trackpad swipes, and the mouse wheel.
 *
 * A trackpad sends a gesture as a burst of wheel events followed by a long
 * inertial tail, and naively each would turn a slide. So deltas build up
 * until they reach one turn, the deck turns once, and everything after is
 * ignored until the wheel has been quiet for a moment: one swipe, one
 * slide. A vertical scroll turns the deck only when the slide has no more
 * room in that direction, so a tall slide still scrolls.
 */
export class WheelGesture {
  private acc = 0;
  private lastAt = Number.NEGATIVE_INFINITY;
  private spent = false;

  feed(dx: number, dy: number, now: number, room: ScrollRoom): 1 | -1 | 0 {
    if (now - this.lastAt > WHEEL_QUIET_MS) {
      this.acc = 0;
      this.spent = false;
    }
    this.lastAt = now;
    if (this.spent) return 0;

    const sideways = Math.abs(dx) >= Math.abs(dy);
    if (!sideways) {
      const scrolling = dy > 0 ? room.canScrollDown : room.canScrollUp;
      // This gesture is scrolling the slide. When its momentum reaches the
      // end, it stops there; turning takes a fresh scroll.
      if (scrolling) {
        this.spent = true;
        return 0;
      }
    }
    this.acc += sideways ? dx : dy;
    if (Math.abs(this.acc) < WHEEL_TURN_PX) return 0;

    this.spent = true;
    return this.acc > 0 ? 1 : -1;
  }
}
