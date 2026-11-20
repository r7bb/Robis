import { type Database, messages, posts, workspaceMembers } from '@robis/database';
import { can, contracts, isUuid } from '@robis/shared';
import { type AnyColumn, and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { postsWire } from '../feed/post-wire.ts';
import { weekStart } from '../feed/week.ts';
import {
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';

/** Items on a page of the feed. More are one Show earlier away, never loaded on their own. */
const FEED_PAGE = 20;

/** The last item of a page: when (in microseconds since 1970, as text) and its id. */
type Cursor = { at: string; id: string };

/** Microseconds since 1970, exact: a JavaScript Date would drop the last three digits. */
const micros = (column: AnyColumn) =>
  sql<string>`((extract(epoch from ${column}) * 1000000)::bigint)::text`;

/** Where the next page starts, opaque to the client. */
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.at}|${cursor.id}`).toString('base64url');
}

/** A cursor this server made, or null: anything else starts from the newest. */
function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const [at, id] = Buffer.from(raw, 'base64url').toString().split('|');
  return at && /^\d{1,20}$/.test(at) && id && isUuid(id) ? { at, id } : null;
}

/**
 * Rows before the cursor, by exact time then id. The time travels in the
 * cursor, so a page still follows on when its last item has since gone.
 */
function before(createdAt: AnyColumn, id: AnyColumn, cursor: Cursor | null) {
  if (!cursor) return undefined;
  return sql`((extract(epoch from ${createdAt}) * 1000000)::bigint, ${id}) < (${cursor.at}::bigint, ${cursor.id}::uuid)`;
}

/** Newest first, by exact time then id, as the database orders them. */
function newestFirst(a: { at: string; id: string }, b: { at: string; id: string }): number {
  const left = BigInt(a.at);
  const right = BigInt(b.at);
  if (left !== right) return left > right ? -1 : 1;
  return b.id.localeCompare(a.id);
}

/**
 * The feed (Phase 2c): the workspace's posts and the pictures from its
 * rooms, newest first, a page at a time. Pictures link back to their
 * message, so the feed points into the work rather than beside it. It has
 * an end: `seenAt` is where you last caught up, and the page says when
 * there is nothing earlier.
 */
export async function feedRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  async function postsBefore(workspaceId: string, cursor: Cursor | null) {
    return db
      .select({ row: posts, at: micros(posts.createdAt) })
      .from(posts)
      .where(and(eq(posts.workspaceId, workspaceId), before(posts.createdAt, posts.id, cursor)))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(FEED_PAGE + 1);
  }

  async function picturesBefore(workspaceId: string, cursor: Cursor | null) {
    return db
      .select({
        messageId: messages.id,
        channelId: messages.channelId,
        authorId: messages.authorId,
        width: messages.imageWidth,
        height: messages.imageHeight,
        createdAt: messages.createdAt,
        at: micros(messages.createdAt),
      })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          isNotNull(messages.imageKey),
          isNotNull(messages.imageWidth),
          isNotNull(messages.imageHeight),
          before(messages.createdAt, messages.id, cursor),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(FEED_PAGE + 1);
  }

  serve(
    app,
    contracts['feed.list'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request, { query: { before: cursorParam } }) => {
      const { workspaceId, role } = currentMembership(request);
      const user = currentUser(request);
      const cursor = decodeCursor(cursorParam);
      // Pictures come from rooms: shown to those who may read the rooms.
      const [postRows, pictureRows, [membership], [checkedIn]] = await Promise.all([
        postsBefore(workspaceId, cursor),
        can(role, 'channel:read') ? picturesBefore(workspaceId, cursor) : [],
        db
          .select({ seenAt: workspaceMembers.feedSeenAt })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, user.id),
            ),
          ),
        db
          .select({ id: posts.id })
          .from(posts)
          .where(
            and(
              eq(posts.workspaceId, workspaceId),
              eq(posts.authorId, user.id),
              eq(posts.kind, 'checkin'),
              gte(posts.createdAt, weekStart()),
            ),
          )
          .limit(1),
      ]);
      const wired = new Map(
        (
          await postsWire(
            db,
            postRows.map((entry) => entry.row),
          )
        ).map((post) => [post.id, post]),
      );
      const merged = [
        ...postRows.map(({ row, at }) => ({
          at,
          id: row.id,
          item: { kind: 'post' as const, post: wired.get(row.id)! },
        })),
        ...pictureRows.map(({ at, ...row }) => ({
          at,
          id: row.messageId,
          item: {
            kind: 'picture' as const,
            picture: {
              ...row,
              width: row.width!,
              height: row.height!,
              url: `/workspaces/${workspaceId}/messages/${row.messageId}/image`,
            },
          },
        })),
      ].sort(newestFirst);
      const page = merged.slice(0, FEED_PAGE);
      const last = page.at(-1);
      return {
        items: page.map((entry) => entry.item),
        seenAt: membership?.seenAt ?? null,
        checkedInThisWeek: checkedIn !== undefined,
        nextCursor:
          merged.length > FEED_PAGE && last ? encodeCursor({ at: last.at, id: last.id }) : null,
      };
    },
  );

  serve(
    app,
    contracts['feed.seen'],
    { preHandler: [requireAuth, requireMembership(db, 'workspace:read')] },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const user = currentUser(request);
      const [row] = await db
        .update(workspaceMembers)
        .set({ feedSeenAt: sql`now()` })
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)),
        )
        .returning({ seenAt: workspaceMembers.feedSeenAt });
      return { seenAt: row!.seenAt! };
    },
  );
}
