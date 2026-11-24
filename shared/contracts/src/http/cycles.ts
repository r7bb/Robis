import { z } from 'zod';
import { ISSUE_STATUSES } from '../domain.ts';
import { dueDateSchema, uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * Cycles: stretches of days a board plans work for, such as two weeks, each
 * with how its issues stand. Members plan and change them; whoever made one,
 * or may manage the board, removes it, leaving its issues unplanned.
 */

/** A cycle is at most this many days, both ends counted. */
export const CYCLE_DAYS_MAX = 56;

const cycle = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
});

const fields = {
  name: z.string().trim().min(1).max(80),
  startsOn: dueDateSchema,
  endsOn: dueDateSchema,
};

/** A running cycle, with its board and the first few issues still open. */
const runningCycle = cycle.extend({
  projectName: z.string(),
  projectKey: z.string(),
  open: z.array(
    z.object({ id: uuid, key: z.string(), title: z.string(), status: z.enum(ISSUE_STATUSES) }),
  ),
});

export const cycleContracts = {
  'cycles.current': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/cycles/current',
    summary:
      'The cycles running today on the workspace’s boards, each with how its issues stand and the first few still open, work under way first.',
    params: workspaceParams,
    query: z.object({ today: dueDateSchema.optional() }),
    response: z.object({ cycles: z.array(runningCycle) }),
  }),
  'cycles.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId/cycles',
    summary: 'A board’s cycles, earliest first, each with how many of its issues are done.',
    params: workspaceParams.extend({ projectId: z.string() }),
    response: z.object({ cycles: z.array(cycle) }),
  }),
  'cycles.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/cycles',
    summary: 'Plan a cycle on a board: a name and the days it runs, at most eight weeks.',
    params: workspaceParams.extend({ projectId: z.string() }),
    body: z.object(fields),
    status: 201,
    response: z.object({ cycle }),
  }),
  'cycles.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/cycles/:cycleId',
    summary: 'Rename a cycle or move its days.',
    params: workspaceParams.extend({ cycleId: z.string() }),
    body: z
      .object(fields)
      .partial()
      .refine((v) => Object.keys(v).length > 0, 'No fields to update'),
    response: z.object({ cycle }),
  }),
  'cycles.rollover': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/cycles/:cycleId/rollover',
    summary:
      'Move a cycle’s unfinished issues, those not done or canceled, to another cycle on the same board.',
    params: workspaceParams.extend({ cycleId: z.string() }),
    body: z.object({ toCycleId: uuid }),
    response: z.object({ moved: z.number().int().nonnegative(), cycle }),
  }),
  'cycles.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/cycles/:cycleId',
    summary: 'Remove a cycle; its issues stay on the board, unplanned.',
    params: workspaceParams.extend({ cycleId: z.string() }),
    status: 204,
    response: null,
  }),
} as const;
