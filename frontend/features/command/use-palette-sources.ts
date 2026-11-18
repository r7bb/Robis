'use client';

import { contracts } from '@robis/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { call } from '../../lib/api.ts';
import { useDebounced } from '../../lib/use-debounced.ts';
import { type WorkspaceSources, workspaceCommands } from '../../lib/workspace-commands.ts';
import { useChannels } from '../chat/use-chat.ts';

/** Wait this long after typing stops before searching, as the search box does: searches are rate limited. */
const SEARCH_DEBOUNCE_MS = 200;
/** Enough of each kind once comments are left out. */
const SEARCH_LIMIT = 15;

/**
 * What the palette lists besides a page's own commands (C2). Boards,
 * channels and people come from the same cached queries as the rest of the
 * workspace, so opening the palette rarely costs a request; issues and
 * documents are searched for once typing pauses.
 */
export function usePaletteSources(
  workspaceId: string,
  query: string,
  pageFilesIssues: boolean,
): ReturnType<typeof workspaceCommands> & { searching: boolean } {
  const router = useRouter();
  const { projectId } = useParams<{ projectId?: string }>();
  const typed = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);

  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const channels = useChannels(workspaceId);
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => call(contracts['members.list'], { params: { workspaceId } }),
  });
  const search = useQuery({
    queryKey: ['palette-search', workspaceId, typed],
    queryFn: () =>
      call(contracts['search.workspace'], {
        params: { workspaceId },
        query: { q: typed, limit: SEARCH_LIMIT },
      }),
    enabled: typed.length > 0,
    staleTime: 30_000,
    // The last results stay up while the next arrive, so the list does not flash.
    placeholderData: keepPreviousData,
  });

  const sources: WorkspaceSources = {
    workspaceId,
    projects: projects.data?.projects ?? [],
    channels: channels.data?.channels ?? [],
    people: members.data?.members ?? [],
    // Results for an older query are never shown, or chosen, under a newer one.
    hits:
      search.data && search.data.query === typed && typed === query.trim()
        ? search.data.results
        : [],
    query,
    currentProjectId: projectId ?? null,
    pageFilesIssues,
    go: (href) => router.push(href),
  };
  return {
    ...workspaceCommands(sources),
    searching: typed !== query.trim() || (typed.length > 0 && search.isFetching),
  };
}
