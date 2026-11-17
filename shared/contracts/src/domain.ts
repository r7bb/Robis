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

/**
 * The job that has a workspace's triage agent look at a new issue (B5): it
 * comments suggested duplicates and a priority, and changes nothing.
 */
export const TRIAGE_JOB = 'agent.triage';
export type TriageJob = { workspaceId: string; issueId: string };

/**
 * Label colours (C1): a fixed palette, so every label is readable on every
 * theme and no one can pick a colour that hides its text.
 */
export const LABEL_COLOURS = ['slate', 'sky', 'emerald', 'amber', 'rose', 'violet'] as const;
export type LabelColour = (typeof LABEL_COLOURS)[number];
