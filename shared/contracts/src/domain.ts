export const ISSUE_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_PRIORITIES = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

/** Board columns, in display order. Canceled issues are hidden from the board. */
export const BOARD_COLUMNS: readonly IssueStatus[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'];

/**
 * What an account is (B5): a person, or an agent an admin added to a
 * workspace. Agents act only through tokens, never sign in, and are marked
 * wherever they appear.
 */
export const USER_KINDS = ['human', 'agent'] as const;
export type UserKind = (typeof USER_KINDS)[number];
