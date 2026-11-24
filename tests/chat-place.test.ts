import { describe, expect, test } from 'bun:test';
import { MESSAGE_REACTIONS } from '@robis/shared';
import { firstUnread, MESSAGE_REACTION_FACES } from '@robis/web/features/chat/chat-place.ts';

/** Where "New" goes in a room, and how each quick reaction looks. */

const at = (minute: number) => new Date(Date.UTC(2026, 10, 24, 10, minute)).toISOString();
const message = (id: string, authorId: string, minute: number) => ({
  id,
  authorId,
  createdAt: at(minute),
});

describe('the New line', () => {
  const messages = [
    message('m1', 'them', 1),
    message('m2', 'me', 5),
    message('m3', 'them', 6),
    message('m4', 'them', 7),
  ];

  test('goes before the first message by someone else after your place', () => {
    expect(firstUnread(messages, at(2), 'me')).toBe('m3');
    expect(firstUnread(messages, at(0), 'me')).toBe('m1');
  });

  test('nowhere when nothing was new, or everything new is yours', () => {
    expect(firstUnread(messages, null, 'me')).toBeNull();
    expect(firstUnread(messages, at(7), 'me')).toBeNull();
    expect(firstUnread([message('m2', 'me', 5)], at(2), 'me')).toBeNull();
  });
});

describe('quick reactions', () => {
  test('each has a glyph and a name a screen reader says', () => {
    for (const reaction of MESSAGE_REACTIONS) {
      expect(MESSAGE_REACTION_FACES[reaction].glyph.length).toBeGreaterThan(0);
      expect(MESSAGE_REACTION_FACES[reaction].name).toMatch(/^[A-Z]/);
    }
  });
});
