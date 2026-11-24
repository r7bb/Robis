import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * Today (a calm list of what to do next): the open issues assigned to you in
 * this workspace, with their due days, for the page to group into overdue,
 * due today, this week and in progress. Meetings and mentions come from the
 * endpoints that already list them.
 */

const mine = z.object({
  id: uuid,
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  priority: z.enum(ISSUE_PRIORITIES),
  dueOn: z.iso.date().nullable(),
  projectId: uuid,
  projectName: z.string(),
});

export const todayContracts = {
  'today.mine': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/today',
    summary:
      'The open issues assigned to you in this workspace, soonest due first, then by priority: what the Today page groups.',
    params: workspaceParams,
    response: z.object({ issues: z.array(mine) }),
  }),
} as const;
