'use client';

import { Avatar } from '../../components/ui/avatar.tsx';
import type { Member } from '../../lib/api.ts';
import { REACTION_MARKS, REACTION_NAMES, type Reaction, reactedBy } from './feed-model.ts';

/**
 * Reactions as faces, never totals: each one pressed when you have, with
 * the first few people who reacted beside it and their names for a screen
 * reader. Posts, celebrations and the replies in a space all use it.
 */

type Reactions = Record<Reaction, readonly string[]>;

const ORDER = Object.keys(REACTION_NAMES) as Reaction[];

export function ReactionBar({
  reactions,
  people,
  me,
  pending,
  onToggle,
  only,
}: {
  reactions: Reactions;
  people: ReadonlyMap<string, Member>;
  me: string | null;
  pending?: boolean;
  onToggle: (reaction: Reaction, on: boolean) => void;
  /** A narrower set, where only some make sense. */
  only?: readonly Reaction[];
}) {
  const names = new Map([...people].map(([id, member]) => [id, member.name]));
  const offered = only ?? ORDER;
  return (
    <div className="flex flex-wrap gap-1.5">
      {offered.map((reaction) => {
        const ids = reactions[reaction] ?? [];
        const mine = me !== null && ids.includes(me);
        const who = reactedBy(ids, me, names);
        return (
          <button
            key={reaction}
            type="button"
            aria-pressed={mine}
            title={who || undefined}
            disabled={pending}
            onClick={() => onToggle(reaction, !mine)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-[background-color,border-color,color,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft ${
              mine
                ? 'border-accent-soft bg-accent/15 text-content'
                : 'border-line text-muted hover:bg-surface hover:text-content'
            }`}
          >
            <span aria-hidden="true" className="text-[13px] leading-none">
              {REACTION_MARKS[reaction]}
            </span>
            {REACTION_NAMES[reaction]}
            {ids.length > 0 ? (
              <span className="flex -space-x-1.5" aria-hidden="true">
                {ids.slice(0, 3).map((id) => (
                  <span key={id} className="flex shrink-0 rounded-full ring-2 ring-raised">
                    <Avatar
                      name={people.get(id)?.name ?? '?'}
                      seed={id}
                      avatar={people.get(id)?.avatar ?? null}
                      size="sm"
                      className="!h-4 !w-4 !text-[7px]"
                    />
                  </span>
                ))}
              </span>
            ) : null}
            {who ? <span className="sr-only">: {who}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
