import { describe, expect, test } from 'bun:test';
import { clampSlide, SLIDES, stepForKey, swipeStep } from '../frontend/features/start/deck.ts';
import { buildChain, editEvent, findBreak } from '../frontend/features/start/mini-chain.ts';

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

describe('the live chain', () => {
  const EVENTS = [
    'created the project',
    'filed ROB-1',
    'moved ROB-1 to In progress',
    'closed ROB-1',
  ];

  test('an untouched chain holds', async () => {
    const chain = await buildChain(EVENTS);
    expect(chain).toHaveLength(4);
    expect(chain[0]!.prev).toBeNull();
    expect(chain[1]!.prev).toBe(chain[0]!.hash);
    expect(await findBreak(chain)).toBeNull();
  });

  test('changing one event breaks the chain exactly there', async () => {
    const chain = await buildChain(EVENTS);
    const edited = editEvent(chain, 2, 'moved ROB-1 to Done');

    expect(await findBreak(edited)).toBe(2);
    // The original is untouched: editing returns a new chain.
    expect(await findBreak(chain)).toBeNull();
  });

  test('putting the event back mends it', async () => {
    const chain = await buildChain(EVENTS);
    const restored = editEvent(editEvent(chain, 1, 'filed ROB-2'), 1, 'filed ROB-1');
    expect(await findBreak(restored)).toBeNull();
  });

  test('hashes are real SHA-256, not a stand-in', async () => {
    const [first] = await buildChain(['x']);
    expect(first!.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
