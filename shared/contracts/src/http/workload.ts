import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * Workload (Insights): what each person has open here, so work can be
 * shared out before someone is buried. People only, never agents; counted
 * when asked, nothing kept.
 */

/** Carrying this many times the team's typical load is called out. */
export const WORKLOAD_HEAVY_RATIO = 2;
/** Below this many open issues nobody is called heavy, however the rest stand. */
export const WORKLOAD_HEAVY_MIN = 5;

export const workloadContracts = {
  'insights.workload': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/insights/workload',
    summary:
      'Each person’s open issues here, or only those in cycles running today: in progress, overdue, due in the next seven days and urgent, most open first, with the team’s median.',
    params: workspaceParams,
    /** Your calendar's today, so overdue means what the board says it means. */
    query: z.object({
      today: z.iso.date().optional(),
      /** `cycles`: only issues in a cycle running today, what is planned now. */
      scope: z.enum(['all', 'cycles']).optional(),
    }),
    response: z.object({
      medianOpen: z.number().nonnegative(),
      people: z.array(
        z.object({
          userId: uuid,
          name: z.string(),
          open: z.number().int().nonnegative(),
          inProgress: z.number().int().nonnegative(),
          overdue: z.number().int().nonnegative(),
          dueSoon: z.number().int().nonnegative(),
          urgent: z.number().int().nonnegative(),
          /** Well above the team's typical load: worth sharing out. */
          heavy: z.boolean(),
        }),
      ),
    }),
  }),
} as const;
