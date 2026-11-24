import type { MessageReaction } from '@robis/shared';

/** Where "New" goes in a room, and how each quick reaction looks. No React, so it is tested alone. */

/** Each reaction's glyph and the name a screen reader says. */
export const MESSAGE_REACTION_FACES: Record<MessageReaction, { glyph: string; name: string }> = {
  ok: { glyph: '👍', name: 'Thumbs up' },
  love: { glyph: '❤️', name: 'Love' },
  laugh: { glyph: '😂', name: 'Laugh' },
  party: { glyph: '🎉', name: 'Party' },
  eyes: { glyph: '👀', name: 'Looking' },
  done: { glyph: '✅', name: 'Done' },
};

/** The first message someone else wrote after the reader's place, if any. */
export function firstUnread(
  messages: readonly { id: string; authorId: string; createdAt: string }[],
  since: string | null,
  me: string | null,
): string | null {
  if (since === null) return null;
  const after = Date.parse(since);
  return messages.find((m) => m.authorId !== me && Date.parse(m.createdAt) > after)?.id ?? null;
}
