'use client';

import { can, contracts, SPACE_DESCRIPTION_MAX_LENGTH, SPACE_NAME_MAX_LENGTH } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { ApiError, call } from '../../lib/api.ts';
import { useT } from '../../lib/i18n/locale-context.tsx';
import { spaceHref } from '../../lib/links.ts';
import { ago } from '../../lib/time.ts';
import { usePeople } from '../../lib/use-people.ts';
import { useWorkspaceRole } from '../workspace/page-frame.tsx';
import { MostHelpful } from './leaders.tsx';
import { type Space, spacesKey, tileTone } from './spaces-model.ts';

/**
 * Spaces: the workspace's topics, each a place to ask and to share what
 * worked, with the most helpful people beside them. Anyone who may post
 * on the feed may start one.
 */

const FIELD =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-content outline-none placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60';

function SpaceCard({ workspaceId, space }: { workspaceId: string; space: Space }) {
  const { t, plural } = useT();
  return (
    <Link
      href={spaceHref(workspaceId, space.id)}
      className="group flex h-full flex-col rounded-xl border border-line bg-raised p-4 shadow-sm transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-accent-soft/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-soft"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-base font-semibold ${tileTone(space.id)}`}
        >
          {space.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-content group-hover:text-accent-soft">
            {space.name}
          </h3>
          <p className="text-xs text-faint">
            {plural('spaces.threads', space.threadCount)}
            {space.lastActivityAt
              ? ` · ${t('spaces.active', { when: ago(space.lastActivityAt) })}`
              : ''}
          </p>
        </div>
      </div>
      {space.description ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted">{space.description}</p>
      ) : null}
    </Link>
  );
}

function StartSpace({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { t } = useT();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const start = useMutation({
    mutationFn: () =>
      call(contracts['spaces.create'], {
        params: { workspaceId },
        body: { name: name.trim(), description: description.trim() || undefined },
      }),
    onSuccess: ({ space }) => {
      void queryClient.invalidateQueries({ queryKey: spacesKey(workspaceId) });
      onDone();
      router.push(spaceHref(workspaceId, space.id));
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) start.mutate();
  }
  return (
    <form
      onSubmit={submit}
      aria-label={t('spaces.start')}
      className="rounded-xl border border-line bg-raised p-4 shadow-sm"
    >
      <label className="block text-xs font-medium text-muted">
        {t('spaces.name')}
        <input
          className={`${FIELD} mt-1`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={SPACE_NAME_MAX_LENGTH}
          placeholder={t('spaces.namePlaceholder')}
          required
        />
      </label>
      <label className="mt-3 block text-xs font-medium text-muted">
        {t('spaces.purpose')}
        <input
          className={`${FIELD} mt-1`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={SPACE_DESCRIPTION_MAX_LENGTH}
          placeholder={t('spaces.purposePlaceholder')}
        />
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={start.isPending || !name.trim()}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98] disabled:opacity-50"
        >
          {start.isPending ? t('spaces.starting') : t('spaces.startIt')}
        </button>
        <button type="button" onClick={onDone} className="text-sm text-muted hover:text-content">
          {t('spaces.cancel')}
        </button>
      </div>
      {start.error ? (
        <p role="alert" className="mt-2 text-sm text-danger-soft">
          {start.error instanceof ApiError ? start.error.message : t('spaces.failed')}
        </p>
      ) : null}
    </form>
  );
}

export function SpacesHome({ workspaceId }: { workspaceId: string }) {
  const { role } = useWorkspaceRole();
  const { people } = usePeople(workspaceId);
  const [starting, setStarting] = useState(false);
  const { t } = useT();
  const list = useQuery({
    queryKey: spacesKey(workspaceId),
    queryFn: () => call(contracts['spaces.list'], { params: { workspaceId } }),
  });
  const spaces = list.data?.spaces ?? [];
  const mayStart = role ? can(role, 'post:create') : false;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="text-balance text-lg font-semibold tracking-tight text-content">
              {t('spaces.title')}
            </h1>
            <p className="mt-1 max-w-[60ch] text-sm text-muted">{t('spaces.lead')}</p>
          </div>
          {mayStart && !starting ? (
            <button
              type="button"
              onClick={() => setStarting(true)}
              className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-contrast transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98]"
            >
              {t('spaces.start')}
            </button>
          ) : null}
        </div>
        {starting ? (
          <div className="mt-4">
            <StartSpace workspaceId={workspaceId} onDone={() => setStarting(false)} />
          </div>
        ) : null}

        {list.isPending ? (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-28 animate-pulse rounded-xl border border-line bg-raised" />
            ))}
          </ul>
        ) : spaces.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-line p-8 text-center">
            <p className="text-sm font-medium text-content">{t('spaces.none')}</p>
            <p className="mx-auto mt-1 max-w-[42ch] text-sm text-muted">{t('spaces.noneLead')}</p>
          </div>
        ) : (
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {spaces.map((space) => (
              <li key={space.id}>
                <SpaceCard workspaceId={workspaceId} space={space} />
              </li>
            ))}
          </ul>
        )}
        {list.isError ? (
          <p role="alert" className="mt-3 text-sm text-muted">
            {t('spaces.unloaded')}
          </p>
        ) : null}
      </div>
      <aside className="lg:pt-1">
        <MostHelpful workspaceId={workspaceId} people={people} />
      </aside>
    </div>
  );
}
