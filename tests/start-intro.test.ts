import { describe, expect, test } from 'bun:test';
import {
  clampSlide,
  QUOTES,
  SLIDES,
  stepForKey,
  swipeStep,
  WheelGesture,
} from '@robis/web/features/start/deck.ts';

/**
 * The "Get started" intro: the pure parts, so the deck's behaviour and the
 * live chain's honesty are held to tests rather than to a screenshot.
 */

describe('the deck', () => {
  test('is short, and ends on the way in', () => {
    expect(SLIDES.length).toBeGreaterThanOrEqual(4);
    expect(SLIDES.length).toBeLessThanOrEqual(6);
    expect(SLIDES.at(-1)!.id).toBe('start');
    expect(new Set(SLIDES.map((slide) => slide.id)).size).toBe(SLIDES.length);
  });

  test('every slide has a short title and a name a screen reader can say', () => {
    for (const slide of SLIDES) {
      expect(slide.title.split(/\s+/).length).toBeLessThanOrEqual(8);
      expect(slide.label.length).toBeGreaterThan(0);
      // The design rule: no em or en dashes in anything a visitor reads.
      expect(`${slide.title} ${slide.body}`).not.toMatch(/[–—]/);
    }
  });

  test('keys move one slide, or to either end', () => {
    expect(stepForKey('ArrowRight')).toBe(1);
    expect(stepForKey('PageDown')).toBe(1);
    expect(stepForKey(' ')).toBe(1);
    expect(stepForKey('ArrowLeft')).toBe(-1);
    expect(stepForKey('PageUp')).toBe(-1);
    expect(stepForKey('Home')).toBe('first');
    expect(stepForKey('End')).toBe('last');
    expect(stepForKey('a')).toBeNull();
  });

  test('never moves past either end', () => {
    expect(clampSlide(-1)).toBe(0);
    expect(clampSlide(SLIDES.length)).toBe(SLIDES.length - 1);
    expect(clampSlide(2)).toBe(2);
  });

  test('a swipe is a deliberate sideways drag, not a scroll or a tap', () => {
    expect(swipeStep(-120, 10)).toBe(1);
    expect(swipeStep(120, 10)).toBe(-1);
    // Too short to mean anything.
    expect(swipeStep(-20, 0)).toBe(0);
    // Mostly vertical: someone scrolling a slide's content.
    expect(swipeStep(-90, 140)).toBe(0);
  });
});

describe('a trackpad swipe', () => {
  test('one sideways swipe turns one slide, however long its inertia runs', () => {
    const gesture = new WheelGesture();
    let turns = 0;
    let now = 0;
    // A real two-finger swipe: a burst of deltas, then a long inertial tail.
    for (const dx of [8, 14, 22, 30, 26, 18, 12, 8, 5, 3, 2, 1, 1]) {
      now += 16;
      const step = gesture.feed(dx, 0, now, { canScrollDown: false, canScrollUp: false });
      if (step !== 0) turns++;
    }
    expect(turns).toBe(1);
  });

  test('right turns forward, left turns back', () => {
    const forward = new WheelGesture();
    const back = new WheelGesture();
    let f = 0;
    let b = 0;
    for (let n = 1; n <= 6; n++) {
      f ||= forward.feed(25, 0, n * 16, { canScrollDown: false, canScrollUp: false });
      b ||= back.feed(-25, 0, n * 16, { canScrollDown: false, canScrollUp: false });
    }
    expect(f).toBe(1);
    expect(b).toBe(-1);
  });

  test('a second swipe after a pause turns again', () => {
    const gesture = new WheelGesture();
    const edges = { canScrollDown: false, canScrollUp: false };
    let turns = 0;
    for (let n = 1; n <= 6; n++) if (gesture.feed(25, 0, n * 16, edges)) turns++;
    for (let n = 1; n <= 6; n++) if (gesture.feed(25, 0, 2000 + n * 16, edges)) turns++;
    expect(turns).toBe(2);
  });

  test('scrolling down a slide that still has room scrolls it, not the deck', () => {
    const gesture = new WheelGesture();
    let turned = 0;
    for (let n = 1; n <= 10; n++) {
      turned ||= gesture.feed(0, 30, n * 16, { canScrollDown: true, canScrollUp: false });
    }
    expect(turned).toBe(0);
  });

  test('scrolling down at the end of a slide moves on', () => {
    const gesture = new WheelGesture();
    let turned = 0;
    for (let n = 1; n <= 10; n++) {
      turned ||= gesture.feed(0, 30, n * 16, { canScrollDown: false, canScrollUp: false });
    }
    expect(turned).toBe(1);
  });

  test('a scroll that runs into the end of a slide stops there, and does not turn it', () => {
    const gesture = new WheelGesture();
    let turned = 0;
    // The first half of the flick still has room; the momentum hits the end.
    for (let n = 1; n <= 20; n++) {
      const room = { canScrollDown: n <= 8, canScrollUp: true };
      turned ||= gesture.feed(0, 30, n * 16, room);
    }
    expect(turned).toBe(0);
    // A fresh scroll after a pause, at the end, moves on.
    for (let n = 1; n <= 10; n++) {
      turned ||= gesture.feed(0, 30, 3000 + n * 16, { canScrollDown: false, canScrollUp: true });
    }
    expect(turned).toBe(1);
  });
});

describe('the quotes', () => {
  test('each is attributed, with where and when it was said', () => {
    expect(Object.keys(QUOTES).length).toBeGreaterThanOrEqual(2);
    for (const quote of Object.values(QUOTES)) {
      expect(quote.text.length).toBeGreaterThan(10);
      expect(quote.who.length).toBeGreaterThan(3);
      expect(quote.source).toMatch(/\d{4}/);
      expect(`${quote.text} ${quote.source}`).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
