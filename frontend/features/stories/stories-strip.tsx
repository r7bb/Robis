'use client';

import { Avatar } from '../../components/ui/avatar.tsx';
import type { Member } from '../../lib/api.ts';
import { useStories } from './stories-context.tsx';
import { StoryRing } from './story-ring.tsx';

/**
 * The team's stories (B2), along the top of the chat where the team is:
 * yours first, with a way to add one, then everyone with something you
 * have not seen, then the rest. Nothing at all with stories off, and only
 * the way to add one when nobody has posted yet.
 */
export function StoriesStrip({ members }: { members: readonly Member[] }) {
  const stories = useStories();
  if (!stories?.enabled) return null;
  const { order, me, canPost } = stories;
  if (order.length === 0 && !canPost) return null;

  const people = new Map(members.map((member) => [member.userId, member]));
  const mine = me ? people.get(me) : undefined;
  const others = order.filter((id) => id !== me && people.has(id));

  return (
    <nav
      aria-label="Stories"
      className="flex shrink-0 items-start gap-3 overflow-x-auto border-b border-line px-3 py-2.5 [scrollbar-width:none]"
    >
      {mine ? <YourStory me={mine} /> : null}
      {others.map((id) => (
        <TheirStory key={id} person={people.get(id)!} unseen={stories.unseen(id)} />
      ))}
    </nav>
  );
}

const LABEL = 'w-full truncate text-center text-[11px]';

/** Your picture: ringed if you have a story, with a + to add one. */
function YourStory({ me }: { me: Member }) {
  const stories = useStories();
  if (!stories) return null;
  const iHaveOne = stories.order.includes(me.userId);
  if (!stories.canPost && !iHaveOne) return null;
  const picture = <Avatar name={me.name} seed={me.userId} avatar={me.avatar} size="lg" />;
  const label = stories.waiting > 0 ? 'Waiting…' : iHaveOne ? 'Yours' : 'Add yours';

  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1">
      <div className="relative">
        {iHaveOne ? (
          <StoryRing userId={me.userId} name={me.name} label="Your story">
            {picture}
          </StoryRing>
        ) : (
          <span className="inline-flex rounded-full p-[3.5px]">{picture}</span>
        )}
        {stories.canPost ? (
          <button
            type="button"
            onClick={stories.compose}
            aria-label="Add a story"
            className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-accent text-sm font-semibold leading-none text-accent-contrast ring-2 ring-raised transition-transform hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-accent-soft"
          >
            <span aria-hidden="true">+</span>
          </button>
        ) : null}
      </div>
      <span className={`${LABEL} text-muted`}>{label}</span>
      <span className="sr-only" aria-live="polite">
        {waitingNote(stories.waiting)}
      </span>
    </div>
  );
}

function waitingNote(waiting: number): string {
  if (waiting === 0) return '';
  return waiting === 1
    ? 'One story is saved on this device and posts when you are back online.'
    : `${waiting} stories are saved on this device and post when you are back online.`;
}

/** Someone else's ringed picture and first name, bolder while unseen. */
function TheirStory({ person, unseen }: { person: Member; unseen: boolean }) {
  const first = person.name.split(/\s+/)[0] ?? person.name;
  return (
    <div className="flex w-14 shrink-0 flex-col items-center gap-1">
      <StoryRing userId={person.userId} name={person.name}>
        <Avatar name={person.name} seed={person.userId} avatar={person.avatar} size="lg" />
      </StoryRing>
      <span className={`${LABEL} ${unseen ? 'font-medium text-content' : 'text-muted'}`}>
        {first}
      </span>
    </div>
  );
}
