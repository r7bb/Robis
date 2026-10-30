import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** Ids stay plain strings: one that is not an attachment is a 404, not a 400. */
const issueParams = workspaceParams.extend({ issueId: z.string() });

/** An image on an issue or a comment; `url` is the members-only route that serves it. */
const attachment = z.object({
  id: uuid,
  issueId: uuid,
  commentId: uuid.nullable(),
  uploaderId: uuid.nullable(),
  contentType: z.string(),
  bytes: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  createdAt: timestamp,
  url: z.string(),
});

export const attachmentContracts = {
  'attachments.upload': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/issues/:issueId/attachments',
    summary:
      "Add an image to an issue, or to one of its comments; it is re-encoded and stripped of metadata, within the workspace's storage limit.",
    params: issueParams,
    query: z.object({ commentId: z.string().optional() }),
    rawBody: 'image/*',
    status: 201,
    response: z.object({ attachment }),
  }),
  'attachments.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/:issueId/attachments',
    summary: "An issue's images, its comments' included.",
    params: issueParams,
    response: z.object({ attachments: z.array(attachment) }),
  }),
  'attachments.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/attachments/:attachmentId',
    summary: 'Remove an image you added, or as an admin, any.',
    params: workspaceParams.extend({ attachmentId: z.string() }),
    status: 204,
    response: null,
  }),
} as const;
