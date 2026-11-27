import { BOARD_COLUMNS, type IssueStatus } from '@robis/shared';
import type { Command } from './commands.ts';

/**
 * The commands a page adds to the palette (C2) while it is on screen. Each
 * names the action its button needs, so the palette hides it exactly when
 * the page hides the button.
 */

/** The open issue: move it to any other status. */
export function issueCommands({
  issueKey,
  status,
  statusLabel,
  setStatus,
  askSapha,
}: {
  issueKey: string;
  status: IssueStatus;
  statusLabel: (status: IssueStatus) => string;
  setStatus: (status: IssueStatus) => void;
  /** Opens Sapha's panel about this issue; left out where Sapha cannot answer. */
  askSapha?: () => void;
}): Command[] {
  const asking: Command[] = askSapha
    ? [
        {
          // No action: asking changes nothing, so anyone who can read the issue may.
          id: 'issue-ask-sapha',
          title: `Ask Sapha about ${issueKey}`,
          group: 'Actions',
          keywords: ['assistant', issueKey],
          run: askSapha,
        },
      ]
    : [];
  return [
    ...asking,
    {
      id: 'issue-status',
      title: `Change status of ${issueKey}…`,
      group: 'Actions',
      action: 'editIssue',
      keywords: ['status', 'move'],
      hint: statusLabel(status),
      flatten: true,
      children: BOARD_COLUMNS.filter((next) => next !== status).map((next) => ({
        id: `issue-status:${next}`,
        title: `Change status to ${statusLabel(next)}`,
        group: 'Actions',
        action: 'editIssue',
        keywords: [issueKey, 'mark', 'move'],
        hint: issueKey,
        run: () => setStatus(next),
      })),
    },
  ];
}

/** The board on screen: file an issue here, select several, drop the filter, see its keys. */
export function boardCommands({
  projectName,
  compose,
  selecting,
  toggleSelecting,
  filtered,
  clearFilters,
  showShortcuts,
}: {
  projectName: string;
  compose: () => void;
  selecting: boolean;
  toggleSelecting: () => void;
  filtered: boolean;
  clearFilters: () => void;
  showShortcuts: () => void;
}): Command[] {
  return [
    {
      id: 'new-issue',
      title: `New issue in ${projectName}`,
      group: 'Actions',
      action: 'newIssue',
      keywords: ['create', 'add', 'file'],
      hint: 'C',
      run: compose,
    },
    {
      id: 'select-issues',
      title: selecting ? 'Stop selecting issues' : 'Select issues',
      group: 'Actions',
      action: 'editIssue',
      keywords: ['bulk', 'several', 'many'],
      hint: 'X',
      run: toggleSelecting,
    },
    {
      id: 'board-shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Actions',
      keywords: ['keys', 'help', 'hotkeys'],
      hint: '?',
      run: showShortcuts,
    },
    ...(filtered
      ? [
          {
            id: 'clear-filters',
            title: 'Clear filters',
            group: 'Actions' as const,
            keywords: ['show all', 'reset'],
            run: clearFilters,
          },
        ]
      : []),
  ];
}
