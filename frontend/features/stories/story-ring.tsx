'use client';

import type { ReactNode } from 'react';
import { useStories } from './stories-context.tsx';

/**
 * A ring round someone's picture while they have a story (B2): in the
 * workspace's colour while there is one you have not seen, quiet once you
 * have. The picture becomes the way to open them. With no story, or stories
 * off, the picture is left exactly as it was.
 */
export function StoryRing({
  userId,
  name,
  children,
  inline = false,
}: {
  userId: string;
  name: string;
  children: ReactNode;
  /** In a row of text: the ring sits outside the picture's own box, so nothing moves. */
  inline?: boolean;
}) {
  const stories = useStories();
  if (!stories?.enabled || !stories.grouped.has(userId)) return <>{children}</>;
  const unseen = stories.unseen(userId);

  return (
    <button
      type="button"
      onClick={(event) => {
        // The picture may sit inside something clickable (a row, a card).
        event.stopPropagation();
        stories.open(userId);
      }}
      aria-label={`${name}'s story${unseen ? ', not seen yet' : ''}`}
      className={`story-ring inline-flex shrink-0 ${inline ? '-m-[3.5px]' : ''} rounded-full p-[2px] transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft`}
      data-unseen={unseen || undefined}
    >
      <span className="inline-flex rounded-full bg-raised p-[1.5px]">{children}</span>
    </button>
  );
}
