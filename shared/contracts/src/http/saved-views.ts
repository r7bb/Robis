import { z } from 'zod';
import { boardFilterSchema, uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Saved views (C1): a board filter with a name, kept per project and shared
 * with everyone in the workspace. Ids in paths stay plain strings, so a
 * malformed one is the same 404 as one that is gone.
 */

/** How many views one project keeps; past this, delete one first. */
export const SAVED_VIEWS_PER_PROJECT = 50;

const projectParams = workspaceParams.extend({ projectId: z.string() });

const savedView = z.object({
  id: uuid,
  projectId: uuid,
  name: z.string(),
  filter: boardFilterSchema,
  createdBy: uuid.nullable(),
  createdAt: timestamp,
});

export const savedViewContracts = {
  'savedViews.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId/views',
    summary: "A project's saved board views, by name.",
    params: projectParams,
    response: z.object({ views: z.array(savedView) }),
  }),
  'savedViews.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/views',
    summary:
      'Name and keep a board filter; names are unique in a project whatever their case, and so are filters.',
    params: projectParams,
    body: z.object({
      name: z.string().trim().min(1, 'Name the view').max(60),
      // An empty filter is the board itself, which needs no name.
      filter: boardFilterSchema.refine(
        (filter) => Object.values(filter).some((value) => value !== undefined),
        'Pick at least one filter to save',
      ),
    }),
    status: 201,
    response: z.object({ view: savedView }),
  }),
  'savedViews.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/views/:viewId',
    summary: 'Delete a saved view.',
    params: workspaceParams.extend({ viewId: z.string() }),
    status: 204,
    response: null,
  }),
};
