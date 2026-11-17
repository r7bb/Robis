import { z } from 'zod';
import { LABEL_COLOURS } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Labels (C1): a workspace's own, each a name and a colour from the fixed
 * palette. Ids in paths stay plain strings: one that is not a label here,
 * however malformed, is the same 404 as one that is gone.
 */

/** The most labels one issue carries. */
export const ISSUE_LABELS_MAX = 20;

const label = z.object({
  id: uuid,
  name: z.string(),
  colour: z.enum(LABEL_COLOURS),
  createdAt: timestamp,
});

export const labelContracts = {
  'labels.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/labels',
    summary: "A workspace's labels, by name.",
    params: workspaceParams,
    response: z.object({ labels: z.array(label) }),
  }),
  'labels.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/labels',
    summary: 'Make a label; names are unique in a workspace, whatever their case.',
    params: workspaceParams,
    body: z.object({
      name: z.string().trim().min(1, 'Name the label').max(40),
      colour: z.enum(LABEL_COLOURS),
    }),
    status: 201,
    response: z.object({ label }),
  }),
  'labels.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/labels/:labelId',
    summary: 'Delete a label; it comes off every issue that had it.',
    params: workspaceParams.extend({ labelId: z.string() }),
    status: 204,
    response: null,
  }),
  'issues.setLabels': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/issues/:issueId/labels',
    summary: "Set an issue's labels: exactly these, replacing what it had.",
    params: workspaceParams.extend({ issueId: z.string() }),
    body: z.object({ labelIds: z.array(uuid).max(ISSUE_LABELS_MAX) }),
    response: z.object({ labelIds: z.array(uuid) }),
  }),
};
