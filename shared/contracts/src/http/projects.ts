import { z } from 'zod';
import { createProjectSchema, updateProjectSchema, uuid } from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

const workspaceParams = z.object({ workspaceId: uuid });

/**
 * The project id stays a plain string: one that is not a project, however
 * malformed, is the same 404 as one that is gone.
 */
const projectParams = workspaceParams.extend({ projectId: z.string() });

/** A project as the API shows it. */
const project = z.object({
  id: uuid,
  workspaceId: uuid,
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archived: z.boolean(),
  createdBy: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const projectContracts = {
  'projects.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects',
    summary: "A workspace's projects, oldest first, each with its count of open issues.",
    params: workspaceParams,
    response: z.object({
      projects: z.array(
        project
          .pick({
            id: true,
            key: true,
            name: true,
            description: true,
            archived: true,
            createdAt: true,
          })
          .extend({ openIssues: z.number().int() }),
      ),
    }),
  }),
  'projects.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects',
    summary: 'Make a project; its key is derived from the name unless given.',
    params: workspaceParams,
    body: createProjectSchema,
    status: 201,
    response: z.object({ project }),
  }),
  'projects.get': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId',
    summary: 'One project.',
    params: projectParams,
    response: z.object({ project }),
  }),
  'projects.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/projects/:projectId',
    summary: 'Rename a project, change its description, or archive it.',
    params: projectParams,
    body: updateProjectSchema,
    response: z.object({ project }),
  }),
  'projects.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/projects/:projectId',
    summary: 'Delete a project and its issues.',
    params: projectParams,
    status: 204,
    response: null,
  }),
} as const;
