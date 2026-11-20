'use client';

import { contracts, PROFILE_TITLE_MAX_LENGTH, WORKING_ON_MAX_LENGTH } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useRef, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { sendImage } from '../../lib/upload.ts';
import { uploadable } from '../issues/attachments.tsx';
import { type ProfileData, profileKey } from './profile-model.ts';

/**
 * Your profile here (B2): a title, what you are on now, and a cover photo.
 * Each is optional and only for this workspace; clearing a field removes it.
 */

const FIELD =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-content placeholder:text-faint focus:border-accent-soft focus:outline-none';
const QUIET =
  'rounded-md border border-line px-3 py-1.5 text-sm text-content transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft disabled:opacity-50';

/** A cover, as it is. */
function putCover(workspaceId: string, image: Blob) {
  return sendImage('PUT', `/workspaces/${workspaceId}/people/me/cover`, image);
}

export function ProfileEditor({
  workspaceId,
  person,
  onDone,
}: {
  workspaceId: string;
  person: ProfileData['profile'];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const titleId = useId();
  const workingId = useId();
  const coverInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(person.title ?? '');
  const [workingOn, setWorkingOn] = useState(person.workingOn ?? '');
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: profileKey(workspaceId, person.userId) }),
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId] }),
    ]);

  const save = useMutation({
    mutationFn: () =>
      call(contracts['profiles.update'], { params: { workspaceId }, body: { title, workingOn } }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
  });
  const cover = useMutation({
    mutationFn: async (file: File) => putCover(workspaceId, await uploadable(file)),
    onSuccess: refresh,
  });
  const removeCover = useMutation({
    mutationFn: () => call(contracts['profiles.removeCover'], { params: { workspaceId } }),
    onSuccess: refresh,
  });
  // Only the latest action's error: an old failure must not outlive a later success.
  const [last, setLast] = useState<'save' | 'cover' | 'remove' | null>(null);
  const error = { save: save.error, cover: cover.error, remove: removeCover.error, none: null }[
    last ?? 'none'
  ];

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLast('save');
    save.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-line bg-raised p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={titleId} className="mb-1 block text-xs font-medium text-muted">
            What you do here
          </label>
          <input
            id={titleId}
            name="title"
            autoComplete="organization-title"
            className={FIELD}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={PROFILE_TITLE_MAX_LENGTH}
            placeholder="Design lead…"
          />
        </div>
        <div>
          <label htmlFor={workingId} className="mb-1 block text-xs font-medium text-muted">
            Working on
          </label>
          <input
            id={workingId}
            name="working-on"
            autoComplete="off"
            className={FIELD}
            value={workingOn}
            onChange={(e) => setWorkingOn(e.target.value)}
            maxLength={WORKING_ON_MAX_LENGTH}
            placeholder="The new onboarding…"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted">Cover</span>
        <input
          ref={coverInput}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              setLast('cover');
              cover.mutate(file);
            }
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={QUIET}
          disabled={cover.isPending}
          onClick={() => coverInput.current?.click()}
        >
          {cover.isPending ? 'Uploading…' : person.cover ? 'Change cover' : 'Add a cover'}
        </button>
        {person.cover ? (
          <button
            type="button"
            className={QUIET}
            disabled={removeCover.isPending}
            onClick={() => {
              setLast('remove');
              removeCover.mutate();
            }}
          >
            Remove cover
          </button>
        ) : null}
      </div>

      <div aria-live="polite">
        {error ? (
          <p className="text-sm text-danger-soft">
            {error instanceof ApiError ? error.message : 'That did not save. Try again.'}
          </p>
        ) : null}
      </div>

      <div className="flex justify-end gap-2">
        <button type="button" className={QUIET} onClick={onDone}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
