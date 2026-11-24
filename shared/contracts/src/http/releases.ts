import { z } from 'zod';
import { ISSUE_STATUSES } from '../domain.ts';
import { dueDateSchema, uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Releases: versions of the work, gathered from any of the workspace's
 * boards and aimed at a day. Members plan and ship them; shipping stamps a
 * release and writes its notes from what was done. Whoever made one, or an
 * admin, removes it, leaving its issues in no release.
 */

const releaseParams = workspaceParams.extend({ releaseId: z.string() });

const release = z.object({
  id: uuid,
  name: z.string(),
  targetOn: z.string().nullable(),
  shippedAt: timestamp.nullable(),
  notes: z.string().nullable(),
  createdBy: uuid.nullable(),
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
});

const releaseIssue = z.object({
  id: uuid,
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  projectId: uuid,
  projectName: z.string(),
});

export const releaseContracts = {
  'releases.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/releases',
    summary:
      'The workspace’s releases: those still to ship by the day they are aimed at, then those shipped, latest first, each with how its issues stand.',
    params: workspaceParams,
    response: z.object({ releases: z.array(release) }),
  }),
  'releases.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/releases',
    summary: 'Plan a release: a name and, if it has one, the day it is aimed at.',
    params: workspaceParams,
    body: z.object({
      name: z.string().trim().min(1).max(80),
      targetOn: dueDateSchema.nullable().optional(),
    }),
    status: 201,
    response: z.object({ release }),
  }),
  'releases.get': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/releases/:releaseId',
    summary: 'One release with its issues from every board, by board and number.',
    params: releaseParams,
    response: z.object({ release, issues: z.array(releaseIssue) }),
  }),
  'releases.ship': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/releases/:releaseId/ship',
    summary:
      'Ship a release: stamp it and keep its notes, written from what was done in it. Once only.',
    params: releaseParams,
    body: z.object({}),
    response: z.object({ release }),
  }),
  'releases.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/releases/:releaseId',
    summary: 'Remove a release; its issues stay where they are, in no release.',
    params: releaseParams,
    status: 204,
    response: null,
  }),
} as const;
