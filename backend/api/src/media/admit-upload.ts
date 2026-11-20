import { resolveSession } from '@robis/auth';
import {
  type Database,
  findMembership,
  WORKSPACE_STORAGE_QUOTA_BYTES,
  workspaceStorageUsed,
} from '@robis/database';
import { isUuid } from '@robis/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.ts';
import { attachAgent, sessionToken } from '../plugins/authz.ts';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from './images.ts';

/**
 * Let image bodies through to this plugin's routes only, as they came.
 * Fastify scopes a parser to the plugin that adds it, so no other route
 * starts accepting binary bodies.
 */
export function acceptImageBodies(app: FastifyInstance) {
  app.addContentTypeParser(
    [...ACCEPTED_TYPES],
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES },
    (_request, body, done) => done(null, body),
  );
}

/**
 * The checks an image upload passes before its body is read (see the note
 * in `avatars.ts`): its size, a session, and for a member, the workspace's
 * storage limit (stage 1, item 11). Anyone else falls through to the
 * membership check's 404, so a full workspace never confirms it exists.
 */
export function admitImageUpload(db: Database) {
  return async function admitUpload(request: FastifyRequest) {
    const incoming = Number(request.headers['content-length'] ?? 0);
    if (incoming > MAX_UPLOAD_BYTES) {
      throw new ApiError(413, 'payload_too_large', 'That image is larger than 8 MB');
    }
    // A person's session, or an agent's token on a workspace route (B5):
    // an agent posting a picture passes the same checks as anyone.
    const token = sessionToken(request);
    if (token) {
      const user = await resolveSession(db, token);
      if (user) request.user = user;
    } else {
      await attachAgent(db, request);
    }
    const user = request.user;
    if (!user) throw ApiError.unauthorized();

    const { workspaceId } = request.params as { workspaceId?: string };
    if (!workspaceId || !isUuid(workspaceId)) return;
    if (!(await findMembership(db, workspaceId, user.id))) return;
    const used = await workspaceStorageUsed(db, workspaceId);
    if (used + incoming > WORKSPACE_STORAGE_QUOTA_BYTES) {
      throw new ApiError(
        413,
        'storage_quota_exceeded',
        'This workspace is out of storage. An owner can make room by deleting old images.',
      );
    }
  };
}

/**
 * The storage limit checked again with the image's real size, once it is
 * processed: the early check trusts Content-Length, which a chunked upload
 * does not send. Refused the same way, before anything is stored.
 */
export async function assertRoomFor(db: Database, workspaceId: string, bytes: number) {
  const used = await workspaceStorageUsed(db, workspaceId);
  if (used + bytes > WORKSPACE_STORAGE_QUOTA_BYTES) {
    throw new ApiError(
      413,
      'storage_quota_exceeded',
      'This workspace is out of storage. An owner can make room by deleting old images.',
    );
  }
}

/**
 * For an image served on the API's own address: nothing in it may run or
 * load anything, even opened on its own in a tab.
 */
export const IMAGE_CSP = "default-src 'none'; sandbox";
