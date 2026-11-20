'use client';

import { contracts } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ago } from '../../components/activity-feed.tsx';
import { Avatar, orbStyle } from '../../components/ui/avatar.tsx';
import { AgentBadge, ErrorState, RoleBadge } from '../../components/ui/primitives.tsx';
import { BASE_URL, call } from '../../lib/api.ts';
import { describeEvent } from '../../lib/audit-events.ts';
import { channelHref, issueHref } from '../../lib/links.ts';
import { StoryRing } from '../stories/story-ring.tsx';
import { ProfileEditor } from './profile-editor.tsx';
import { type ProfileData, profileKey } from './profile-model.ts';

/**
 * A member's profile in this workspace (B2): their cover, picture, title
 * and what they are on now; what they have been doing, of the kinds you
 * may read; and the images they have shared. Your own has an Edit button.
 */

export function ProfileView({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const profile = useQuery({
    queryKey: profileKey(workspaceId, userId),
    queryFn: () => call(contracts['profiles.get'], { params: { workspaceId, userId } }),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => call(contracts['auth.me']),
    retry: false,
  });
  const [editing, setEditing] = useState(false);

  if (profile.isError) return <ErrorState message={(profile.error as Error).message} />;
  if (!profile.data) return <ProfileSkeleton />;
  const { profile: person, activity, shared } = profile.data;
  const mine = me.data?.user.id === person.userId;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <Cover person={person} />
      <div className="-mt-12 flex flex-wrap items-end justify-between gap-4 px-4">
        <span className="rounded-full bg-surface p-1">
          <StoryRing userId={person.userId} name={person.name}>
            <Avatar name={person.name} seed={person.userId} avatar={person.avatar} size="2xl" />
          </StoryRing>
        </span>
        {mine && !editing ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mb-1 rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-content transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
          >
            Edit profile
          </button>
        ) : null}
      </div>

      <header className="mt-3 px-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-balance text-xl font-semibold tracking-tight text-content">
            {person.name}
          </h1>
          {person.kind === 'agent' ? <AgentBadge /> : null}
          <RoleBadge role={person.role.toLowerCase()} />
        </div>
        <p className="mt-0.5 text-sm text-faint">
          @{person.username}
          {person.title ? <span className="text-muted"> · {person.title}</span> : null}
        </p>
        {person.workingOn ? (
          <p className="mt-3 inline-flex max-w-full items-baseline gap-2 rounded-full border border-line bg-raised px-3 py-1 text-sm">
            <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-faint">
              Working on
            </span>
            <span className="min-w-0 break-words text-content">{person.workingOn}</span>
          </p>
        ) : null}
      </header>

      {editing ? (
        <div className="mt-6 px-4">
          <ProfileEditor
            workspaceId={workspaceId}
            person={person}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : null}

      <div className="mt-10 grid gap-10 px-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Activity events={activity} mine={mine} />
        <Shared workspaceId={workspaceId} images={shared} mine={mine} />
      </div>
    </div>
  );
}

/** Their cover photo, or a band drawn from their id, so no profile is bare. */
function Cover({ person }: { person: ProfileData['profile'] }) {
  if (person.cover) {
    return (
      // A plain img: the bytes come with the session cookie, members only.
      // biome-ignore lint/performance/noImgElement: see above
      <img
        src={`${BASE_URL}${person.cover}`}
        alt=""
        width={1500}
        height={500}
        className="aspect-[3/1] w-full rounded-xl bg-raised object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="aspect-[3/1] w-full rounded-xl opacity-80"
      style={orbStyle(person.userId)}
    />
  );
}

function Activity({ events, mine }: { events: ProfileData['activity']; mine: boolean }) {
  return (
    <section aria-labelledby="profile-activity">
      <h2 id="profile-activity" className="text-xs font-medium uppercase tracking-wide text-faint">
        Recent activity
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-raised px-4 py-6 text-center text-sm text-faint">
          {mine ? 'What you do here shows up here.' : 'Nothing here yet.'}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-raised">
          {events.map((event) => (
            <li
              key={event.id}
              className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 break-words text-muted">
                {describeEvent(event.eventType, event.payload)}
              </span>
              <time
                dateTime={event.createdAt}
                title={new Date(event.createdAt).toLocaleString()}
                className="shrink-0 text-xs text-faint"
              >
                {ago(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Shared({
  workspaceId,
  images,
  mine,
}: {
  workspaceId: string;
  images: ProfileData['shared'];
  mine: boolean;
}) {
  return (
    <section aria-labelledby="profile-shared">
      <h2 id="profile-shared" className="text-xs font-medium uppercase tracking-wide text-faint">
        Shared
      </h2>
      {images.length === 0 ? (
        <p className="mt-3 rounded-lg border border-line bg-raised px-4 py-6 text-center text-sm text-faint">
          {mine
            ? 'Images you add to issues or post in chat gather here. Paste a screenshot into either to start.'
            : 'No images shared yet.'}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-3 gap-2">
          {images.map((image) => (
            <li key={image.id}>
              <Link
                href={
                  image.issueId
                    ? issueHref(workspaceId, image.issueId)
                    : channelHref(workspaceId, image.channelId ?? '')
                }
                className="group block overflow-hidden rounded-lg border border-line bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
              >
                {/* biome-ignore lint/performance/noImgElement: members-only bytes with the session cookie */}
                <img
                  src={`${BASE_URL}${image.url}`}
                  alt={`${image.issueId ? 'Added to an issue' : 'Posted in chat'} ${ago(image.createdAt)}`}
                  width={image.width}
                  height={image.height}
                  loading="lazy"
                  decoding="async"
                  className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The page's shape while it loads, so nothing jumps when it arrives. */
function ProfileSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8" aria-busy="true">
      <div className="aspect-[3/1] w-full animate-pulse rounded-xl bg-raised motion-reduce:animate-none" />
      <div className="-mt-12 px-4">
        <div className="h-[7.5rem] w-[7.5rem] rounded-full border-4 border-surface bg-raised" />
      </div>
      <div className="mt-4 h-5 w-48 rounded bg-raised px-4" />
    </div>
  );
}
