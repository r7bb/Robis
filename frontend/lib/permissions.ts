import { can, type Permission, type Role } from '@robis/shared';

/**
 * What each action on screen needs (C2), as the API's own permission.
 *
 * A button and the command palette both ask `may`, so a command the palette
 * hides is one whose button is hidden too, and neither offers what the
 * server would refuse.
 */
export const ACTIONS = {
  /** File an issue: the board's Add issue, a sub-issue, the palette's New issue. */
  newIssue: 'issue:create',
  /** Change an issue: its status, priority, assignee, labels, place on the board. */
  editIssue: 'issue:update',
  deleteIssue: 'issue:delete',
  openBoard: 'project:read',
  /** Make a board: the sidebar's New board, or asking Sapha for one. */
  newBoard: 'project:create',
  /** Keep the board's filter as a saved view. */
  saveView: 'project:update',
} as const satisfies Record<string, Permission>;

export type Action = keyof typeof ACTIONS;

/** Whether this role may take this action; never before the role is known. */
export function may(role: Role | undefined, action: Action): boolean {
  return role !== undefined && can(role, ACTIONS[action]);
}
