import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Project updates: a few words on how a board is going, with the team's
 * own judgement of it, on the board and on the feed beside the health
 * worked out from its issues. Members write them; an author or an admin
 * takes one down.
 */

export const PROJECT_UPDATE_HEALTH = ['on_track', 'at_risk', 'off_track'] as const;
export type ProjectUpdateHealth = (typeof PROJECT_UPDATE_HEALTH)[number];
export const PROJECT_UPDATE_MAX_LENGTH = 2000;
/** An update older than this is not shown on the feed: it no longer says how things are. */
export const PROJECT_UPDATE_FRESH_DAYS = 30;

const update = z.object({
  id: uuid,
  projectId: uuid,
  health: z.enum(PROJECT_UPDATE_HEALTH),
  body: z.string(),
  authorId: uuid,
  authorName: z.string(),
  createdAt: timestamp,
});

const projectParams = workspaceParams.extend({ projectId: z.string() });

export const projectUpdateContracts = {
  'projectUpdates.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId/updates',
    summary: 'A board’s written updates, newest first, the latest twenty.',
    params: projectParams,
    response: z.object({ updates: z.array(update) }),
  }),
  'projectUpdates.latest': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/project-updates/latest',
    summary: 'Each board’s latest written update from the last thirty days, for the feed.',
    params: workspaceParams,
    response: z.object({ updates: z.array(update) }),
  }),
  'projectUpdates.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/updates',
    summary: 'Write how a board is going, and whether it is on track, at risk or off track.',
    params: projectParams,
    body: z.object({
      health: z.enum(PROJECT_UPDATE_HEALTH),
      body: z.string().trim().min(1).max(PROJECT_UPDATE_MAX_LENGTH),
    }),
    status: 201,
    response: z.object({ update }),
  }),
  'projectUpdates.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/project-updates/:updateId',
    summary: 'Take down an update you wrote, or as an admin, any.',
    params: workspaceParams.extend({ updateId: z.string() }),
    status: 204,
    response: null,
  }),
} as const;
