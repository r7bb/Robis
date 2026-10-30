import { z } from 'zod';
import { ROLES } from '../rbac.ts';
import {
  confirmPasswordSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  uuid,
} from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

const workspaceParams = z.object({ workspaceId: uuid });

/**
 * A workspace as the API shows it. The theme is a plain string, as stored:
 * an id the web app no longer knows falls back rather than failing.
 */
const workspace = z.object({
  id: uuid,
  name: z.string(),
  slug: z.string(),
  theme: z.string(),
  createdBy: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** A workspace, with the caller's role in it. */
const workspaceWithRole = workspace.extend({ role: z.enum(ROLES) });

/** One entry of a workspace's activity feed. */
const activityEvent = z.object({
  id: uuid,
  actorId: uuid.nullable(),
  actorName: z.string().nullable(),
  entityType: z.string(),
  entityId: uuid,
  eventType: z.string(),
  /** What the event recorded, with a member's personal fields until erased. */
  payload: z.record(z.string(), z.unknown()),
  createdAt: timestamp,
});

export const workspaceContracts = {
  'workspaces.list': contract({
    method: 'GET',
    path: '/workspaces',
    summary: 'The workspaces you are a member of, oldest first.',
    response: z.object({
      workspaces: z.array(
        workspace
          .pick({ id: true, name: true, slug: true, theme: true, createdAt: true })
          .extend({ role: z.enum(ROLES) }),
      ),
    }),
  }),
  'workspaces.create': contract({
    method: 'POST',
    path: '/workspaces',
    summary: 'Make a workspace, with you as its owner and a #general channel.',
    body: createWorkspaceSchema,
    status: 201,
    response: z.object({ workspace: workspaceWithRole }),
  }),
  'workspaces.get': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId',
    summary: 'One workspace you are a member of.',
    params: workspaceParams,
    response: z.object({ workspace: workspaceWithRole }),
  }),
  'workspaces.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId',
    summary: 'Rename a workspace or change its theme.',
    params: workspaceParams,
    body: updateWorkspaceSchema,
    response: z.object({ workspace }),
  }),
  'workspaces.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId',
    summary: 'Delete a workspace and everything in it, confirmed with your password.',
    params: workspaceParams,
    body: confirmPasswordSchema,
    status: 204,
    response: null,
  }),
  'workspaces.activity': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/activity',
    summary: 'The last 100 things that happened in a workspace, newest first.',
    params: workspaceParams,
    response: z.object({ events: z.array(activityEvent) }),
  }),
} as const;
