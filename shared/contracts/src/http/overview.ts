import { z } from 'zod';
import { ISSUE_STATUSES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { avatar } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** One workspace on the home: counts, faces, two weeks of activity and the latest event. */
const workspaceOverview = z.object({
  id: uuid,
  openIssues: z.number().int(),
  /** Bytes stored and allowed, for owners only (stage 1, item 11). */
  storage: z.object({ used: z.number(), quota: z.number() }).nullable(),
  memberCount: z.number().int(),
  members: z.array(z.object({ id: uuid, name: z.string(), avatar })),
  /** Fourteen days, oldest first; the last is today. */
  activity: z.array(z.number().int()),
  latest: z
    .object({
      kind: z.enum(['issue.created', 'comment.created']),
      actorName: z.string().nullable(),
      issueId: uuid,
      issueTitle: z.string(),
      at: z.string(),
    })
    .nullable(),
});

const assignedIssue = z.object({
  id: uuid,
  workspaceId: uuid,
  workspaceName: z.string(),
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  updatedAt: timestamp,
});

export const overviewContracts = {
  'workspaces.overview': contract({
    method: 'GET',
    path: '/workspaces/overview',
    summary:
      'The home in one read: every workspace you are in, and the open issues assigned to you.',
    response: z.object({
      workspaces: z.array(workspaceOverview),
      /** The five most recently touched. */
      assigned: z.array(assignedIssue),
      /** All of them, which the hero says. */
      assignedTotal: z.number().int(),
    }),
  }),
} as const;
