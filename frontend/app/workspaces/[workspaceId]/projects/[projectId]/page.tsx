'use client';

import {
  type Avatar as AvatarRef,
  BOARD_COLUMNS,
  type BoardFilter,
  can,
  contracts,
  type IssuePriority,
  type IssueStatus,
} from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type KeyboardEvent, Suspense, useEffect, useState } from 'react';
import { DeleteButton } from '../../../../../components/delete-button.tsx';
import { PresenceBar } from '../../../../../components/presence.tsx';
import { SyncStatus } from '../../../../../components/sync-status.tsx';
import { Avatar } from '../../../../../components/ui/avatar.tsx';
import {
  LabelChip,
  PriorityBadge,
  StatusHeading,
  statusLabel,
} from '../../../../../components/ui/badges.tsx';
import { ErrorState } from '../../../../../components/ui/primitives.tsx';
import { useBoardDrag } from '../../../../../features/board/board-drag.ts';
import { BoardFilters } from '../../../../../features/board/board-filters.tsx';
import { DuplicateHints } from '../../../../../features/issues/duplicate-hints.tsx';
import { PriorityHint } from '../../../../../features/issues/priority-hint.tsx';
import { call } from '../../../../../lib/api.ts';
import {
  filterFromParams,
  filterToQuery,
  isFiltered,
  matchesFilter,
} from '../../../../../lib/board-filter.ts';
import { useCoalesced, useRealtime } from '../../../../../lib/realtime.ts';
import { concernsBoard } from '../../../../../lib/realtime-events.ts';
import { lastTheme, useApplyTheme } from '../../../../../lib/theme.ts';
import { useMemberAvatars } from '../../../../../lib/use-member-avatars.ts';
import { useOfflineBoard } from '../../../../../lib/use-offline-board.ts';

function Board() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const avatars = useMemberAvatars();
  const [title, setTitle] = useState('');
  // Picked from the priority hint, or not at all; never guessed silently.
  // Kept with the title it was picked for: a suggestion is about that text,
  // so rewriting the title drops it rather than filing a stale priority.
  const [chosen, setChosen] = useState<{ priority: IssuePriority; forTitle: string } | null>(null);
  const priority = chosen && chosen.forTitle === title ? chosen.priority : null;

  // The board reads from IndexedDB rather than the network, so it renders with
  // no connection and survives a reload mid-edit.
  const board = useOfflineBoard(workspaceId, projectId);

  // The filter lives in the URL (C1), so a filtered board is a link. Every
  // issue is already on the device, so narrowing it needs no request.
  const router = useRouter();
  const pathname = usePathname();
  const filter = filterFromParams(useSearchParams());
  const setFilter = (next: BoardFilter) => {
    const query = filterToQuery(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const shown = board.issues.filter((issue) => matchesFilter(issue, filter));
  const columns = BOARD_COLUMNS.filter((column) => !filter.status || column === filter.status);
  const drag = useBoardDrag(shown, columns, board.updateIssue);
  const labels = useQuery({
    queryKey: ['labels', workspaceId],
    queryFn: () => call(contracts['labels.list'], { params: { workspaceId } }),
  });
  const labelById = new Map((labels.data?.labels ?? []).map((label) => [label.id, label]));

  // Reporting the project as our location is what lets other people see who
  // else is looking at this board. An issue event for this project pulls
  // through to a reconcile, so someone else's change lands immediately
  // instead of waiting for the next scheduled sync; anything else (a chat
  // message, another project's issue) does not touch the board, and a burst
  // is one pull.
  const pullBoard = useCoalesced(board.refresh);
  const { presence, state: realtimeState } = useRealtime(
    workspaceId,
    projectId,
    (event) => {
      if (concernsBoard(event, projectId)) pullBoard();
    },
    // Only this project's issues reach the socket at all (stage 3, item 24).
    { scopes: [{ kind: 'project', projectId }] },
  );
  // Events sent while the connection was down are not replayed, so the board
  // is read again whenever it comes back.
  useEffect(() => {
    if (realtimeState === 'live') pullBoard();
  }, [realtimeState, pullBoard]);

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });

  useApplyTheme(workspace.data?.workspace.theme ?? lastTheme());

  // Reconnecting means we may have missed events while the socket was down.
  const { refresh } = board;
  useEffect(() => {
    if (realtimeState === 'live') void refresh();
  }, [realtimeState, refresh]);

  if (workspace.isError) return <ErrorState message={(workspace.error as Error).message} />;

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setTitle('');
    setChosen(null);
    void board.createIssue({ title: trimmed, ...(priority ? { priority } : {}) });
  }

  const role = workspace.data?.workspace.role;
  const canEdit = role !== undefined && role !== 'GUEST';
  const canDelete = role !== undefined && can(role, 'issue:delete');

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      {/* Said aloud as a card is lifted, moved and dropped by keyboard. */}
      <p className="sr-only" aria-live="assertive">
        {drag.said}
      </p>
      <nav className="text-sm text-faint">
        <Link href="/workspaces" className="hover:text-muted">
          Workspaces
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/workspaces/${workspaceId}`} className="hover:text-muted">
          {workspace.data?.workspace.name ?? '…'}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-muted">Board</span>
      </nav>

      <div className="mt-4 flex items-center justify-between gap-4">
        <SyncStatus online={board.online} pending={board.pending} />
        <PresenceBar users={presence} state={realtimeState} here={projectId} />
      </div>

      {canEdit && (
        <div className="mt-6">
          <form onSubmit={onCreate} className="flex gap-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs doing?"
              className="flex-1 rounded-md border border-line bg-raised px-3 py-2 text-sm outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              Add issue
            </button>
          </form>

          {/* Below the form, never inside it: a hint must not be reachable
              by Tab between the field and the submit button, and must not
              move the button as it appears and disappears. */}
          <PriorityHint
            workspaceId={workspaceId}
            title={title}
            chosen={priority}
            onChoose={(next) => setChosen(next ? { priority: next, forTitle: title } : null)}
          />
          <DuplicateHints workspaceId={workspaceId} title={title} />
        </div>
      )}

      <BoardFilters
        workspaceId={workspaceId}
        projectId={projectId}
        filter={filter}
        onChange={setFilter}
        canEdit={canEdit}
        labels={labels.data?.labels ?? []}
      />

      {/* Always mounted, so a change of count is announced, not just shown. */}
      <p className="mt-3 min-h-4 text-xs text-faint" aria-live="polite">
        {filterSummary(filter, shown.length, board.issues.length)}
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        {columns.map((column) => {
          const columnIssues = shown.filter((issue) => issue.status === column);

          return (
            <section key={column} className="rounded-lg border border-line bg-raised/50 p-3">
              <StatusHeading status={column} count={columnIssues.length} />

              <ul
                className="mt-3 min-h-12 space-y-2"
                onDragOver={(event) => {
                  if (drag.dragging) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const over = (event.target as HTMLElement).closest('[data-index]');
                  drag.onDrop(column, over ? Number(over.getAttribute('data-index')) : null);
                }}
              >
                {columnIssues.map((issue, index) => (
                  <li
                    key={issue.id}
                    {...drag.cardProps(issue.id, index, canEdit)}
                    className={[
                      'rounded-md border bg-raised p-3 transition-[opacity,box-shadow] duration-[var(--micro)]',
                      issue.pending ? 'border-amber-500/40' : 'border-line',
                      drag.cardState(issue.id),
                    ].join(' ')}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-[10px] text-faint">{issue.key}</span>

                      {canEdit && (
                        <MoveButton
                          label={issue.key}
                          lifted={drag.lifted?.id === issue.id}
                          onKeyDown={(event) => drag.onKeyDown(event, issue)}
                        />
                      )}

                      {/* Deleting goes through the same offline queue as every
                          other board write, so it works with no connection. */}
                      <DeleteButton
                        allowed={canDelete}
                        kind="issue"
                        name={issue.pending ? issue.title : `${issue.key} · ${issue.title}`}
                        onConfirm={() => board.deleteIssue(issue.id)}
                        className="-my-1 -mr-1 order-last"
                      />

                      {issue.pending ? (
                        <span
                          title="Saved on this device, not yet synced"
                          className="text-[10px] uppercase tracking-wide text-amber-500/90"
                        >
                          Unsynced
                        </span>
                      ) : (
                        <PriorityBadge priority={issue.priority} />
                      )}
                    </div>

                    {/* Offline-created issues have no server row yet, so
                        there is nothing to open until they sync. */}
                    {issue.pending ? (
                      <p className="mt-1 text-sm text-content">{issue.title}</p>
                    ) : (
                      <Link
                        href={`/workspaces/${workspaceId}/issues/${issue.id}`}
                        className="mt-1 block text-sm text-content hover:text-content hover:underline"
                      >
                        {issue.title}
                      </Link>
                    )}

                    <CardLabels ids={issue.labelIds} labels={labelById} />

                    {issue.assigneeName && (
                      <Assignee name={issue.assigneeName} id={issue.assigneeId} avatars={avatars} />
                    )}

                    {canEdit && (
                      <select
                        value={issue.status}
                        onChange={(event) =>
                          void board.updateIssue(issue.id, {
                            status: event.target.value as IssueStatus,
                          })
                        }
                        aria-label={`Status for ${issue.key}`}
                        className="mt-3 w-full rounded border border-line bg-surface px-2 py-1 text-xs text-muted outline-none transition focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        {BOARD_COLUMNS.map((status) => (
                          <option key={status} value={status}>
                            {statusLabel(status)}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}

/** Who a card is assigned to: their picture and name, quietly. */
function Assignee({
  name,
  id,
  avatars,
}: {
  name: string;
  id: string | null;
  avatars: ReadonlyMap<string, AvatarRef>;
}) {
  const avatar = id ? (avatars.get(id) ?? null) : null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
      <Avatar name={name} seed={id ?? undefined} avatar={avatar} size="sm" />
      {name}
    </p>
  );
}

/** The keyboard way to move a card; pointers drag the card itself. */
function MoveButton({
  label,
  lifted,
  onKeyDown,
}: {
  label: string;
  lifted: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      onKeyDown={onKeyDown}
      aria-label={`Move ${label}: Space to lift, arrow keys to move, Space to drop`}
      aria-pressed={lifted}
      className="cursor-grab rounded px-1 text-[10px] text-faint transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
    >
      Move
    </button>
  );
}

/** A card's labels, as chips; nothing at all for a card with none. */
function CardLabels({
  ids,
  labels,
}: {
  ids: readonly string[] | undefined;
  labels: ReadonlyMap<string, { name: string; colour: string }>;
}) {
  const shown = (ids ?? []).flatMap((id) => {
    const label = labels.get(id);
    return label ? [{ id, ...label }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap gap-1">
      {shown.map((label) => (
        <LabelChip key={label.id} name={label.name} colour={label.colour} />
      ))}
    </p>
  );
}

/** `useSearchParams` needs a boundary so the route can still be prerendered. */
export default function BoardPage() {
  return (
    <Suspense
      fallback={<main className="mx-auto max-w-6xl px-6 py-12 text-sm text-faint">Loading…</main>}
    >
      <Board />
    </Suspense>
  );
}

/** What a filter leaves showing, said once; nothing when there is no filter. */
function filterSummary(filter: BoardFilter, shown: number, total: number): string {
  if (!isFiltered(filter)) return '';
  if (shown === 0) return 'No issues match these filters.';
  return `Showing ${shown} of ${total} issues.`;
}
