import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Workspace exports (C6): everything the workspace owns as JSON lines plus
 * its attachments, in a zip built by a job. An admin asks for one, waits
 * for it to be ready, then asks for a download link: a single-purpose
 * address that works once, for a few minutes, signed in as an admin.
 */

export const EXPORT_STATUSES = ['pending', 'ready', 'failed', 'downloaded', 'expired'] as const;
/** How long a ready export is kept for download before its file is purged. */
export const EXPORT_KEEP_DAYS = 7;
/** How long a download link works for, once made. */
export const EXPORT_LINK_MINUTES = 5;
/** How many past exports the list shows. */
export const EXPORTS_SHOWN = 10;

const workspaceParams = z.object({ workspaceId: uuid });

const workspaceExport = z.object({
  id: uuid,
  status: z.enum(EXPORT_STATUSES),
  bytes: z.number().int().nullable(),
  error: z.string().nullable(),
  requestedBy: uuid.nullable(),
  createdAt: timestamp,
  readyAt: timestamp.nullable(),
  downloadedAt: timestamp.nullable(),
});

export const exportContracts = {
  'exports.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/exports',
    summary: 'The latest exports of this workspace, newest first. Admins only.',
    params: workspaceParams,
    response: z.object({ exports: z.array(workspaceExport) }),
  }),
  'exports.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/exports',
    summary:
      'Ask for an export of everything the workspace owns; built by a job. Refused while one is being built. Admins only.',
    params: workspaceParams,
    status: 202,
    response: z.object({ export: workspaceExport }),
  }),
  'exports.link': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/exports/:exportId/link',
    summary: `A download address for a ready export: it works once, for ${EXPORT_LINK_MINUTES} minutes, and only signed in as an admin of the workspace. Making another replaces it.`,
    params: workspaceParams.extend({ exportId: uuid }),
    response: z.object({ url: z.string(), expiresAt: timestamp }),
  }),
};
