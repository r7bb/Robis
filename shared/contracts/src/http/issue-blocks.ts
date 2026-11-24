import { z } from 'zod';
import { ISSUE_STATUSES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * Blocked by: one issue holding up another. An issue lists what it waits on
 * and what waits on it; a board learns which of its issues still wait.
 */

/** The most issues one issue may wait on. */
export const BLOCKERS_MAX = 20;

const issueParams = workspaceParams.extend({ issueId: z.string() });

const related = z.object({
  id: uuid,
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
});

const blocks = z.object({
  /** What this issue waits on. */
  blockedBy: z.array(related),
  /** What waits on this issue. */
  blocking: z.array(related),
});

export const issueBlockContracts = {
  'issues.blocks': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/:issueId/blocks',
    summary: 'What an issue waits on, and what waits on it.',
    params: issueParams,
    response: blocks,
  }),
  'issues.addBlocker': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/issues/:issueId/blocked-by',
    summary:
      'Say an issue waits on another in this workspace; refused if it is itself, or would make a loop.',
    params: issueParams,
    body: z.object({ blockerId: uuid }),
    status: 201,
    response: blocks,
  }),
  'issues.removeBlocker': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/issues/:issueId/blocked-by/:blockerId',
    summary: 'Say an issue no longer waits on another.',
    params: issueParams.extend({ blockerId: z.string() }),
    response: blocks,
  }),
  'projects.blocked': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId/blocked',
    summary: 'The issues on a board that still wait on an issue not yet done or canceled.',
    params: workspaceParams.extend({ projectId: z.string() }),
    response: z.object({ issueIds: z.array(uuid) }),
  }),
} as const;
