'use client';

import { resolveTheme } from '@robis/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { MyInvitations } from '../../components/my-invitations.tsx';
import { NotificationBell } from '../../components/notification-bell.tsx';
import type { RiverSeries } from '../../features/home/activity-river.tsx';
import { HomeHero } from '../../features/home/home-hero.tsx';
import { LiveFeed } from '../../features/home/live-feed.tsx';
import { NeedsYou } from '../../features/home/needs-you.tsx';
import { NewWorkspace } from '../../features/home/new-workspace.tsx';
import { useHomeLive } from '../../features/home/use-home-live.ts';
import { OVERVIEW_KEY, useOverview } from '../../features/home/use-overview.ts';
import { WorkspaceGrid } from '../../features/home/workspace-grid.tsx';
import { api, type Me, type WorkspaceSummary } from '../../lib/api.ts';
import { getSyncEngine } from '../../lib/sync.ts';
import { useRequireAvatar } from '../../lib/use-require-avatar.ts';
import './home.css';

/**
 * Workspaces kept live on the home, each with its own gateway connection.
 * The rest still show their counts; they just do not pulse, and are not in
 * the activity river.
 */
const LIVE_WORKSPACES = 6;
/** One empty list, so memos keyed on it hold still while loading. */
const NONE: WorkspaceSummary[] = [];

/**
 * The signed-in home: who is here, what needs you, what is happening, and
 * every workspace you are in. See `frontend/features/home`.
 */
export default function WorkspacesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
  useRequireAvatar(me.data);

  const workspaces = useQuery({
    queryKey: ['workspaces'],
    queryFn: () => api<{ workspaces: WorkspaceSummary[] }>('/workspaces'),
    enabled: me.isSuccess,
  });
  const overview = useOverview(me.isSuccess);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
  };

  const createWorkspace = useMutation({
    mutationFn: (workspaceName: string) =>
      api<{ workspace: WorkspaceSummary }>('/workspaces', {
        method: 'POST',
        body: { name: workspaceName },
      }),
    onSuccess: refreshAll,
  });

  const deleteWorkspace = useMutation({
    mutationFn: ({ workspaceId, password }: { workspaceId: string; password: string }) =>
      api<void>(`/workspaces/${workspaceId}`, { method: 'DELETE', body: { password } }),
    onSuccess: refreshAll,
  });

  const signOut = useMutation({
    mutationFn: async () => {
      await api<void>('/auth/logout', { method: 'POST' });
      // A shared or borrowed computer must not keep this account's cached
      // issues, queued edits or waiting images for the next person.
      await getSyncEngine().clearLocal();
    },
    onSuccess: () => {
      // Navigate before clearing: dropping the cache first makes this still
      // mounted page refetch `/auth/me`, get a 401, and bounce through the
      // unauthenticated redirect below for no reason.
      router.replace('/login');
      queryClient.clear();
    },
  });

  const list = workspaces.data?.workspaces ?? NONE;
  const workspaceNames = useMemo(() => new Map(list.map((w) => [w.id, w.name])), [list]);
  const myId = me.data?.user.id ?? '';
  const live = useHomeLive({ myId, overview: overview.data, workspaceNames });
  const overviewById = new Map((overview.data?.workspaces ?? []).map((w) => [w.id, w]));
  const openTotal = (overview.data?.workspaces ?? []).reduce((sum, w) => sum + w.openIssues, 0);
  const accentBy = new Map(list.map((w) => [w.id, resolveTheme(w.theme).tokens.accent]));
  // The river: the workspaces kept live, in the same order as the tiles.
  const river: RiverSeries[] = list.slice(0, LIVE_WORKSPACES).map((w) => ({
    id: w.id,
    name: w.name,
    accent: accentBy.get(w.id)!,
    values: overviewById.get(w.id)?.activity ?? Array<number>(14).fill(0),
  }));

  // `/auth/me` failing means no valid session -- the cookie expired, or the
  // user just signed out. Redirecting has to happen in an effect: navigation
  // updates the router's state, and React forbids updating another component
  // while this one is rendering.
  const unauthenticated = me.isError;
  const firstName = me.data?.user.name.split(' ')[0];

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
  }, [unauthenticated, router]);

  if (unauthenticated) return null;

  return (
    <main className="min-h-[100dvh] bg-surface pb-20">
      <HomeHero
        firstName={firstName}
        series={river}
        spark={live.spark}
        offline={live.mode === 'offline'}
        connected={live.connected}
        partial={list.length > LIVE_WORKSPACES}
        here={live.others.length}
        waiting={overview.data ? overview.data.assignedTotal : null}
        open={overview.data ? openTotal : null}
        actions={
          <>
            <NotificationBell />
            <Link
              href="/account"
              className="whitespace-nowrap text-sm text-muted hover:text-content"
            >
              Account
            </Link>
            <button
              type="button"
              onClick={() => signOut.mutate()}
              className="whitespace-nowrap text-sm text-muted hover:text-content"
            >
              Sign out
            </button>
          </>
        }
      />

      {/* Positioned, so it paints above the hero it overlaps. */}
      <div className="relative mx-auto -mt-6 max-w-6xl px-4 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="min-w-0 space-y-4">
            <NeedsYou issues={overview.data?.assigned ?? []} loading={overview.isPending} />
            <MyInvitations me={me.data} focusAfter="workspaces-heading" />
          </div>
          <LiveFeed
            accentBy={accentBy}
            items={live.feed}
            connected={live.connected}
            everConnected={live.everConnected}
          />
        </div>

        {overview.isError && (
          <p role="alert" className="mt-4 text-sm text-danger-soft">
            The workspace summary did not load.{' '}
            <button
              type="button"
              onClick={() => overview.refetch()}
              className="underline underline-offset-2 hover:text-content"
            >
              Try again
            </button>
          </p>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight text-content">Your workspaces</h2>
          <NewWorkspace
            onCreate={(name) => createWorkspace.mutateAsync(name)}
            pending={createWorkspace.isPending}
            error={createWorkspace.isError ? (createWorkspace.error as Error).message : null}
          />
        </div>

        <WorkspaceGrid
          loading={workspaces.isPending}
          workspaces={list}
          overviewById={overviewById}
          myId={myId}
          liveCount={LIVE_WORKSPACES}
          signals={live.signals}
          onDelete={(workspaceId, password) =>
            deleteWorkspace.mutateAsync({ workspaceId, password })
          }
        />
      </div>
    </main>
  );
}
