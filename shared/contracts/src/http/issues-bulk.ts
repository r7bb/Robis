import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * One change to many issues (C1). Each issue is judged on its own: one the
 * caller may not change, cannot see, or that the change would leave as it
 * is, is skipped and reported with the reason; the rest change together.
 */

/** The most issues one request may name. */
export const BULK_ISSUES_MAX = 100;

/** Why an issue was left alone. */
export const BULK_SKIP_REASONS = [
  'not_found',
  'forbidden',
  'unchanged',
  'too_many_labels',
] as const;

const bulkChange = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: z.enum(ISSUE_STATUSES) }),
  z.object({ kind: z.literal('priority'), priority: z.enum(ISSUE_PRIORITIES) }),
  z.object({ kind: z.literal('assignee'), assigneeId: uuid.nullable() }),
  z.object({ kind: z.literal('addLabel'), labelId: uuid }),
  z.object({ kind: z.literal('removeLabel'), labelId: uuid }),
  z.object({ kind: z.literal('delete') }),
]);

export type BulkChange = z.infer<typeof bulkChange>;

export const bulkIssueContracts = {
  'issues.bulk': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/issues/bulk',
    summary:
      'Apply one change to many issues: a status, priority, assignee, a label on or off, or delete. Issues the caller may not change are skipped and reported with the reason.',
    params: workspaceParams,
    body: z.object({
      // Plain strings, like ids in paths: one that is not an issue here,
      // however malformed, is skipped as not found rather than failing all.
      issueIds: z.array(z.string().max(64)).min(1).max(BULK_ISSUES_MAX),
      change: bulkChange,
    }),
    response: z.object({
      changed: z.array(uuid),
      skipped: z.array(z.object({ id: z.string(), reason: z.enum(BULK_SKIP_REASONS) })),
    }),
  }),
};
