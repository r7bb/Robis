'use client';

import {
  type Avatar as AvatarRef,
  BOARD_COLUMNS,
  type BoardFilter,
  contracts,
  type IssuePriority,
} from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { DeleteButton } from '../../components/delete-button.tsx';
import { SyncStatus } from '../../components/sync-status.tsx';
import { Avatar } from '../../components/ui/avatar.tsx';
import { LabelDot, PriorityBadge, StatusHeading } from '../../components/ui/badges.tsx';
import { DueChip } from '../../components/ui/due-chip.tsx';
import { Kbd } from '../../components/ui/kbd.tsx';
import { ErrorState } from '../../components/ui/primitives.tsx';
import { call } from '../../lib/api.ts';
import {
  filterFromParams,
  filterToQuery,
  isFiltered,
  matchesFilter,
} from '../../lib/board-filter.ts';
import { COMPOSE_PARAM } from '../../lib/links.ts';
import { boardCommands } from '../../lib/page-commands.ts';
import { may } from '../../lib/permissions.ts';
import { useCoalesced } from '../../lib/realtime.ts';
import { concernsBoard } from '../../lib/realtime-events.ts';
import { useMemberAvatars } from '../../lib/use-member-avatars.ts';
import { useOfflineBoard } from '../../lib/use-offline-board.ts';
import { useCommands, useOpenPalette } from '../command/command-provider.tsx';
import { DuplicateHints } from '../issues/duplicate-hints.tsx';
import { PriorityHint } from '../issues/priority-hint.tsx';
import { useLive, useLiveEvents } from '../workspace/live.tsx';
import { useBoardDrag } from './board-drag.ts';
import { BoardFilters } from './board-filters.tsx';
import { BulkBar } from './bulk-bar.tsx';
import { DeleteBoard } from './delete-board.tsx';
import { ShortcutHelp } from './shortcut-help.tsx';
import { useBoardKeyboard } from './use-board-keyboard.ts';
import { useSelection } from './use-selection.ts';

/**
 * A project's board: the middle of the workspace (see `WorkspaceFrame`),
 * with the chat docked below it and the boards listed on the left.
 */
export function ProjectBoard({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
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
  const params = useSearchParams();
  const filter = filterFromParams(params);
  const setFilter = (next: BoardFilter) => {
    const query = filterToQuery(next);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
  const shown = board.issues.filter((issue) => matchesFilter(issue, filter));
  const columns = BOARD_COLUMNS.filter((column) => !filter.status || column === filter.status);
  const drag = useBoardDrag(shown, columns, board.updateIssue);
  const selection = useSelection();
  // Where focus goes once a bulk change is done and its picks are gone.
  const selectToggle = useRef<HTMLButtonElement>(null);
  // The new issue field, which the palette's New issue (C2) jumps to.
  const titleField = useRef<HTMLInputElement>(null);
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
  // The frame's one connection (it reports this board as where we are, and
  // hears this project's issues); a burst of events is one pull.
  const { state: realtimeState } = useLive();
  useLiveEvents((event) => {
    if (concernsBoard(event, projectId)) pullBoard();
  });
  // Events sent while the connection was down are not replayed, so the board
  // is read again whenever it comes back.
  useEffect(() => {
    if (realtimeState === 'live') pullBoard();
  }, [realtimeState, pullBoard]);

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => call(contracts['workspaces.get'], { params: { workspaceId } }),
  });

  const role = workspace.data?.workspace.role;
  // The same checks the palette makes for its commands (C2).
  const canCreate = may(role, 'newIssue');
  const canEdit = may(role, 'editIssue');
  const canDelete = may(role, 'deleteIssue');

  const projects = useQuery({
    queryKey: ['projects', workspaceId],
    queryFn: () => call(contracts['projects.list'], { params: { workspaceId } }),
  });
  const projectName = projects.data?.projects.find((p) => p.id === projectId)?.name ?? 'this board';
  const compose = () => {
    titleField.current?.scrollIntoView({ block: 'nearest' });
    titleField.current?.focus();
  };
  const [helpOpen, setHelpOpen] = useState(false);
  useCommands(
    boardCommands({
      projectName,
      compose,
      selecting: selection.on,
      toggleSelecting: selection.toggleOn,
      filtered: isFiltered(filter),
      clearFilters: () => setFilter({}),
      showShortcuts: () => setHelpOpen(true),
    }),
  );

  // The board's single keys (C2), each gated as its button is.
  const { keepFocusOn } = useBoardKeyboard({
    role,
    columns: columns.map((column) => shown.filter((i) => i.status === column).map((i) => i.id)),
    cards: shown,
    compose,
    setStatus: (id, status) => void board.updateIssue(id, { status }),
    lift: drag.lift,
    select: (id) => {
      if (!selection.on) selection.toggleOn();
      selection.toggle(id);
    },
    openPalette: useOpenPalette(),
    openHelp: () => setHelpOpen(true),
    selecting: selection.on,
    stopSelecting: () => {
      selection.toggleOn();
      selectToggle.current?.focus();
    },
  });

  // Arrived from the palette's New issue elsewhere: straight to the field,
  // then the address loses the flag so a reload does not do it again.
  const composing = params.get(COMPOSE_PARAM) !== null;
  useEffect(() => {
    if (!composing || !canCreate) return;
    titleField.current?.focus();
    const query = filterToQuery(filterFromParams(new URLSearchParams(window.location.search)));
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [composing, canCreate, router, pathname]);

  if (workspace.isError) return <ErrorState message={(workspace.error as Error).message} />;

  function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setTitle('');
    setChosen(null);
    void board.createIssue({ title: trimmed, ...(priority ? { priority } : {}) });
  }

  return (
    <div className="px-6 py-6">
      {/* Said aloud as a card is lifted, moved and dropped by keyboard. */}
      <p className="sr-only" aria-live="assertive">
        {drag.said}
      </p>
      <div className="flex items-center justify-between gap-4">
        <span className="flex min-w-0 items-center gap-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-content">
            {projectName}
          </h1>
          <DeleteBoard
            workspaceId={workspaceId}
            projectId={projectId}
            name={projectName}
            role={role}
          />
        </span>
        <SyncStatus online={board.online} pending={board.pending} />
      </div>

      {canCreate && (
        <div className="mt-6">
          <form onSubmit={onCreate} className="flex gap-2">
            <input
              ref={titleField}
              aria-label="New issue title"
              // Escape leaves the field (keeping what was typed), back to the board's keys (C2).
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                  event.currentTarget.blur();
                }
              }}
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
        canEdit={may(role, 'saveView')}
        labels={labels.data?.labels ?? []}
      />

      <div className="mt-3 flex items-center justify-between gap-4">
        {/* Always mounted, so a change of count is announced, not just shown. */}
        <p className="min-h-4 text-xs text-faint" aria-live="polite">
          {filterSummary(filter, shown.length, board.issues.length)}
        </p>
        <span className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
          >
            Shortcuts <Kbd>?</Kbd>
          </button>
          {canEdit && (
            <button
              type="button"
              ref={selectToggle}
              aria-pressed={selection.on}
              onClick={selection.toggleOn}
              className="rounded px-1.5 py-0.5 text-xs text-muted transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
            >
              {selection.on ? 'Done selecting' : 'Select issues'}
            </button>
          )}
        </span>
      </div>
      {helpOpen && <ShortcutHelp role={role} onClose={() => setHelpOpen(false)} />}

      {selection.on && (
        <BulkBar
          workspaceId={workspaceId}
          // Only cards on show that exist on the server: a filter can hide a
          // pick, and a card made offline has nothing to change yet.
          issueIds={shown.filter((i) => !i.pending && selection.has(i.id)).map((i) => i.id)}
          online={board.online}
          canDelete={canDelete}
          labels={labels.data?.labels ?? []}
          onDone={() => {
            selection.clear();
            selectToggle.current?.focus();
            void board.refresh();
          }}
        />
      )}

      {/* Columns never narrower than a card's title needs: between the left
          rail and the right one the board scrolls sideways instead. */}
      <div className="mt-6 grid gap-4 md:auto-cols-[minmax(11.5rem,1fr)] md:grid-flow-col">
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
                    // Focused whole by the J, K, H and L keys (C2); Enter on it opens it.
                    data-card={issue.id}
                    data-status={issue.status}
                    tabIndex={-1}
                    aria-label={`${issue.key} ${issue.title}`}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
                      if (issue.pending) return;
                      event.preventDefault();
                      router.push(`/workspaces/${workspaceId}/issues/${issue.id}`);
                    }}
                    className={[
                      'group rounded-md border bg-raised p-3 outline-none transition-[opacity,box-shadow] duration-[var(--micro)] focus-visible:ring-2 focus-visible:ring-accent-soft',
                      issue.pending ? 'border-amber-500/40' : 'border-line',
                      drag.cardState(issue.id),
                    ].join(' ')}
                  >
                    <CardHeader
                      issue={issue}
                      canEdit={canEdit}
                      canDelete={canDelete}
                      lifted={drag.lifted?.id === issue.id}
                      onMoveKey={(event) => {
                        // Dropped into another column, the card is drawn anew; focus follows it.
                        const lifted = drag.lifted;
                        const dropping = event.key === ' ' || event.key === 'Enter';
                        if (dropping && lifted?.id === issue.id && lifted.status !== issue.status) {
                          keepFocusOn(issue.id, 'move');
                        }
                        drag.onKeyDown(event, issue);
                      }}
                      onMoveBlur={() => drag.putBack(issue)}
                      onDelete={() => board.deleteIssue(issue.id)}
                      selecting={selection.on}
                      selected={selection.has(issue.id)}
                      onSelect={() => selection.toggle(issue.id)}
                    />

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

                    <CardFooter issue={issue} labels={labelById} avatars={avatars} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Card controls that wait for the pointer or for focus, on a screen with a
 * pointer; on a touch screen there is no hover, so they always show.
 */
const QUIET =
  'transition-opacity duration-[var(--micro)] [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100';

/**
 * A card's top line: its pick box while selecting, its key and Move on the
 * left; its priority (or Unsynced) and Delete on the right.
 */
function CardHeader({
  issue,
  canEdit,
  canDelete,
  lifted,
  onMoveKey,
  onMoveBlur,
  onDelete,
  selecting,
  selected,
  onSelect,
}: {
  issue: { key: string; title: string; pending: boolean; priority: IssuePriority };
  canEdit: boolean;
  canDelete: boolean;
  lifted: boolean;
  onMoveKey: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onMoveBlur: () => void;
  onDelete: () => void;
  selecting: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        {selecting && !issue.pending && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onSelect}
            aria-label={`Select ${issue.key}`}
            className="accent-accent"
          />
        )}
        <span className="whitespace-nowrap font-mono text-[10px] text-faint">{issue.key}</span>
        {canEdit && (
          <span className={lifted ? '' : QUIET}>
            <MoveButton
              label={issue.key}
              lifted={lifted}
              onKeyDown={onMoveKey}
              onBlur={onMoveBlur}
            />
          </span>
        )}
      </span>
      <span className="flex items-center gap-1">
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
        {/* Deleting goes through the same offline queue as every other
            board write, so it works with no connection. */}
        <span className={QUIET}>
          <DeleteButton
            allowed={canDelete}
            kind="issue"
            name={issue.pending ? issue.title : `${issue.key} · ${issue.title}`}
            onConfirm={onDelete}
            className="-my-1 -mr-1"
          />
        </span>
      </span>
    </div>
  );
}

/** The keyboard way to move a card; pointers drag the card itself. */
function MoveButton({
  label,
  lifted,
  onKeyDown,
  onBlur,
}: {
  label: string;
  lifted: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Leaving the button puts a lifted card back. */
  onBlur: () => void;
}) {
  return (
    <button
      type="button"
      data-move
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      aria-label={`Move ${label}: Space to lift, arrow keys to move, Space to drop`}
      aria-pressed={lifted}
      className="cursor-grab rounded px-1 text-[10px] text-faint transition-colors hover:text-content focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-soft"
    >
      Move
    </button>
  );
}

/**
 * A card's last line, the same height on every card: a dot for each label
 * and the due date on the left, the assignee's face on the right. The names
 * are in the dots' and the face's titles and read aloud, and written out in
 * full in the issue itself.
 */
function CardFooter({
  issue,
  labels,
  avatars,
}: {
  issue: {
    labelIds?: readonly string[];
    dueOn?: string | null;
    status: string;
    assigneeName?: string | null;
    assigneeId?: string | null;
  };
  labels: ReadonlyMap<string, { name: string; colour: string }>;
  avatars: ReadonlyMap<string, AvatarRef>;
}) {
  const shown = (issue.labelIds ?? []).flatMap((id) => {
    const label = labels.get(id);
    return label ? [{ id, ...label }] : [];
  });
  if (shown.length === 0 && !issue.dueOn && !issue.assigneeName) return null;
  const finished = issue.status === 'DONE' || issue.status === 'CANCELED';

  return (
    <div className="mt-2 flex min-h-6 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2">
        {shown.length > 0 ? (
          <span className="flex items-center gap-1">
            {shown.map((label) => (
              <LabelDot key={label.id} name={label.name} colour={label.colour} />
            ))}
          </span>
        ) : null}
        {issue.dueOn ? <DueChip dueOn={issue.dueOn} finished={finished} /> : null}
      </span>
      {issue.assigneeName ? (
        <span title={issue.assigneeName} className="shrink-0">
          <Avatar
            name={issue.assigneeName}
            seed={issue.assigneeId ?? undefined}
            avatar={issue.assigneeId ? (avatars.get(issue.assigneeId) ?? null) : null}
            size="sm"
          />
          <span className="sr-only">Assigned to {issue.assigneeName}</span>
        </span>
      ) : null}
    </div>
  );
}

/** What a filter leaves showing, said once; nothing when there is no filter. */
function filterSummary(filter: BoardFilter, shown: number, total: number): string {
  if (!isFiltered(filter)) return '';
  if (shown === 0) return 'No issues match these filters.';
  return `Showing ${shown} of ${total} issues.`;
}
