import { describe, expect, test } from 'bun:test';
import { SyncPair, shiftCaret } from '../frontend/features/landing/sync-pair.ts';

/*
 * The landing page's live demo claims to show what Robis does: two people
 * edit the same text, the network drops, both keep typing, and on reconnect
 * nothing is lost. These tests hold the demo to that claim, so the one
 * interactive thing on the marketing page cannot quietly lie.
 */

describe('SyncPair', () => {
  test('both sides start from the same text', () => {
    const pair = new SyncPair('Ship the offline queue');

    expect(pair.text('you')).toBe('Ship the offline queue');
    expect(pair.text('mia')).toBe('Ship the offline queue');
  });

  test('an edit online reaches the other side at once', () => {
    const pair = new SyncPair('Ship it');

    pair.edit('you', 'Ship it today');

    expect(pair.text('mia')).toBe('Ship it today');
    expect(pair.pending('you')).toBe(0);
  });

  test('offline edits stay local and are counted as waiting', () => {
    const pair = new SyncPair('Ship it');
    pair.setOnline(false);

    pair.edit('you', 'Ship it today');
    pair.edit('you', 'Ship it today, please');
    pair.edit('mia', 'Please ship it');

    expect(pair.text('you')).toBe('Ship it today, please');
    expect(pair.text('mia')).toBe('Please ship it');
    expect(pair.pending('you')).toBe(2);
    expect(pair.pending('mia')).toBe(1);
  });

  test('reconnecting merges both sides and loses neither', () => {
    const pair = new SyncPair('Ship it');
    pair.setOnline(false);
    pair.edit('you', 'Ship it today');
    pair.edit('mia', 'Please ship it');

    const result = pair.setOnline(true);

    expect(pair.text('you')).toBe(pair.text('mia'));
    expect(pair.text('you')).toContain('Please');
    expect(pair.text('you')).toContain('today');
    // One offline edit on each side.
    expect(result.merged).toBe(2);
    expect(pair.pending('you')).toBe(0);
    expect(pair.pending('mia')).toBe(0);
  });

  test('both typing at the same spot offline still converges', () => {
    const pair = new SyncPair('ab');
    pair.setOnline(false);
    pair.edit('you', 'aXb');
    pair.edit('mia', 'aYb');

    pair.setOnline(true);

    expect(pair.text('you')).toBe(pair.text('mia'));
    expect(pair.text('you')).toHaveLength(4);
  });

  test('reconnecting with nothing waiting merges nothing', () => {
    const pair = new SyncPair('Ship it');
    pair.setOnline(false);

    expect(pair.setOnline(true).merged).toBe(0);
  });

  test('an edit that changes nothing is not counted', () => {
    const pair = new SyncPair('Ship it');
    pair.setOnline(false);

    pair.edit('you', 'Ship it');

    expect(pair.pending('you')).toBe(0);
  });

  test('listeners hear every change and can unsubscribe', () => {
    const pair = new SyncPair('Ship it');
    let heard = 0;
    const stop = pair.subscribe(() => {
      heard += 1;
    });

    pair.edit('you', 'Ship it now');
    const afterOne = heard;
    stop();
    pair.edit('you', 'Ship it now!');

    expect(afterOne).toBeGreaterThan(0);
    expect(heard).toBe(afterOne);
  });
});

describe('shiftCaret', () => {
  test('text inserted before the caret pushes it right', () => {
    expect(shiftCaret(5, { from: 0, to: 0, insert: 'abc' })).toBe(8);
  });

  test('text deleted before the caret pulls it left', () => {
    expect(shiftCaret(5, { from: 1, to: 3, insert: '' })).toBe(3);
  });

  test('a change after the caret leaves it alone', () => {
    expect(shiftCaret(2, { from: 4, to: 6, insert: 'x' })).toBe(2);
  });

  test('a deletion spanning the caret lands it at the start of the change', () => {
    expect(shiftCaret(5, { from: 3, to: 8, insert: 'z' })).toBe(4);
  });
});
