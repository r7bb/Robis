import { type Database, feedMutes, follows, workspaceMembers } from '@robis/database';
import { contracts, isUuid } from '@robis/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** Follows and mutes a person may change in an hour. */
const CHANGES_PER_HOUR = 300;
const HOUR_MS = 3_600_000;

/** Whom one person follows, and whom they muted, in a workspace. */
export async function feedChoices(db: Database, workspaceId: string, userId: string) {
  const [following, muted] = await Promise.all([
    db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(and(eq(follows.workspaceId, workspaceId), eq(follows.followerId, userId))),
    db
      .select({ id: feedMutes.mutedId })
      .from(feedMutes)
      .where(and(eq(feedMutes.workspaceId, workspaceId), eq(feedMutes.userId, userId))),
  ]);
  return { following: following.map((r) => r.id), muted: muted.map((r) => r.id) };
}

/**
 * Following and muting (the feed, made quieter): a person chooses whose posts
 * the Following feed shows, and whose the Everyone feed leaves out. Both are
 * the chooser's alone: nobody is told they were followed or muted, and
 * neither is audited, as a reaction is not. Only members here can be chosen.
 */
export async function followRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const limit = rateLimit({ name: 'feed-follow', limit: CHANGES_PER_HOUR, windowMs: HOUR_MS });
  const pre = [requireAuth, requireMembership(db, 'workspace:read'), limit];

  /** The person chosen: a member here other than you, or 404 / 400. */
  async function chosen(request: FastifyRequest, userId: string) {
    const { workspaceId } = currentMembership(request);
    const me = currentUser(request).id;
    if (!isUuid(userId)) throw ApiError.notFound('Member not found');
    if (userId === me) throw ApiError.badRequest('That is you', 'self');
    const [member] = await db
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    if (!member) throw ApiError.notFound('Member not found');
    return { workspaceId, me };
  }

  serve(
    app,
    contracts['follows.list'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) =>
      feedChoices(db, currentMembership(request).workspaceId, currentUser(request).id),
  );

  serve(app, contracts['follows.follow'], { preHandler: pre }, async (request, { params }) => {
    const { workspaceId, me } = await chosen(request, params.userId);
    await db
      .insert(follows)
      .values({ workspaceId, followerId: me, followeeId: params.userId })
      .onConflictDoNothing();
    return undefined;
  });

  serve(app, contracts['follows.unfollow'], { preHandler: pre }, async (request, { params }) => {
    const { workspaceId, me } = await chosen(request, params.userId);
    await db
      .delete(follows)
      .where(
        and(
          eq(follows.workspaceId, workspaceId),
          eq(follows.followerId, me),
          eq(follows.followeeId, params.userId),
        ),
      );
    return undefined;
  });

  serve(app, contracts['follows.mute'], { preHandler: pre }, async (request, { params }) => {
    const { workspaceId, me } = await chosen(request, params.userId);
    await db
      .insert(feedMutes)
      .values({ workspaceId, userId: me, mutedId: params.userId })
      .onConflictDoNothing();
    return undefined;
  });

  serve(app, contracts['follows.unmute'], { preHandler: pre }, async (request, { params }) => {
    const { workspaceId, me } = await chosen(request, params.userId);
    await db
      .delete(feedMutes)
      .where(
        and(
          eq(feedMutes.workspaceId, workspaceId),
          eq(feedMutes.userId, me),
          eq(feedMutes.mutedId, params.userId),
        ),
      );
    return undefined;
  });
}
