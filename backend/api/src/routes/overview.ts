import {
  attachments,
  type Database,
  issues,
  projects,
  WORKSPACE_STORAGE_QUOTA_BYTES,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { contracts } from '@robis/shared';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { avatarOf } from '../media/avatars.ts';
import { currentUser, requireAuth, requirePicture } from '../plugins/authz.ts';

/** Days of activity each tile shows, oldest first. */
const ACTIVITY_DAYS = 14;
/** Members shown on a tile; the rest are a count. */
const MEMBERS_SHOWN = 5;
/** Open issues on the "needs you" list, across every workspace. */
const ASSIGNED_SHOWN = 5;
/** An issue is open until it is finished one way or the other. */
const CLOSED_STATUSES = ['DONE', 'CANCELED'] as const;

type MemberRow = {
  workspaceId: string;
  userId: string;
  name: string;
  avatarKind: 'photo' | 'generated' | null;
  avatarRef: string | null;
  avatarUpdatedAt: Date | null;
  total: number;
};

type ActivityRow = { workspaceId: string; daysAgo: number; n: number };

type LatestRow = {
  workspaceId: string;
  kind: 'issue.created' | 'comment.created';
  actorName: string | null;
  issueId: string;
  issueTitle: string;
  at: Date;
};

/** `ARRAY[$1, $2, ...]::uuid[]`, each id a bound parameter. */
function uuidArray(ids: readonly string[]) {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
}

/**
 * The signed-in home: one call for everything the workspace tiles and the
 * "needs you" list show.
 *
 * Only what any member may already read. Every role can read issues and
 * comments, so those are the activity; messages are left out, since a
 * channel can be private, and so is the audit trail, which some roles
 * cannot read. The latest action says who and on which issue, never what a
 * comment said.
 */
export async function overviewRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['workspaces.overview'],
    { preHandler: [requireAuth, requirePicture] },
    async (request) => {
      const user = currentUser(request);

      const mine = await db
        .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(eq(workspaceMembers.userId, user.id))
        .orderBy(workspaces.createdAt);
      if (mine.length === 0) return { workspaces: [], assigned: [], assignedTotal: 0 };
      const ids = mine.map((w) => w.id);

      // Open, yours, and in a workspace you are still in: an issue left
      // assigned to someone who has since been removed is not theirs to see.
      const assignedToMe = and(
        eq(issues.assigneeId, user.id),
        inArray(issues.workspaceId, ids),
        notInArray(issues.status, [...CLOSED_STATUSES]),
      );

      const [open, members, activity, latest, assigned, [assignedCount]] = await Promise.all([
        db
          .select({ workspaceId: issues.workspaceId, n: sql<number>`count(*)::int` })
          .from(issues)
          .where(
            and(inArray(issues.workspaceId, ids), notInArray(issues.status, [...CLOSED_STATUSES])),
          )
          .groupBy(issues.workspaceId),

        db.execute<MemberRow>(sql`
        SELECT workspace_id AS "workspaceId", user_id AS "userId", name,
               avatar_kind AS "avatarKind", avatar_ref AS "avatarRef",
               avatar_updated_at AS "avatarUpdatedAt", total
        FROM (
          SELECT m.workspace_id, u.id AS user_id, u.name, u.avatar_kind, u.avatar_ref,
                 u.avatar_updated_at,
                 row_number() OVER (PARTITION BY m.workspace_id ORDER BY m.created_at, u.id) AS rn,
                 (count(*) OVER (PARTITION BY m.workspace_id))::int AS total
          FROM workspace_members m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ANY(${uuidArray(ids)})
        ) ranked
        WHERE rn <= ${MEMBERS_SHOWN}
        ORDER BY workspace_id, rn`),

        // Days counted in UTC, today as 0. An edit counts once it is more than
        // a moment after creation, so making an issue is not counted twice.
        db.execute<ActivityRow>(sql`
        SELECT workspace_id AS "workspaceId", days_ago AS "daysAgo", count(*)::int AS n
        FROM (
          SELECT workspace_id,
                 (now() AT TIME ZONE 'UTC')::date - (at AT TIME ZONE 'UTC')::date AS days_ago
          FROM (
            SELECT workspace_id, created_at AS at FROM issues
              WHERE workspace_id = ANY(${uuidArray(ids)})
            UNION ALL
            SELECT workspace_id, updated_at FROM issues
              WHERE workspace_id = ANY(${uuidArray(ids)})
                AND updated_at > created_at + interval '1 second'
            UNION ALL
            SELECT workspace_id, created_at FROM comments
              WHERE workspace_id = ANY(${uuidArray(ids)})
          ) events
          WHERE at > now() - make_interval(days => ${ACTIVITY_DAYS + 1})
        ) dated
        WHERE days_ago BETWEEN 0 AND ${ACTIVITY_DAYS - 1}
        GROUP BY 1, 2`),

        // The newest issue or comment per workspace: one probe each of the
        // (workspace_id, created_at) indexes.
        db.execute<LatestRow>(sql`
        SELECT w.id AS "workspaceId", l.kind, u.name AS "actorName",
               l.issue_id AS "issueId", i.title AS "issueTitle", l.at
        FROM unnest(${uuidArray(ids)}) AS w(id)
        CROSS JOIN LATERAL (
          (SELECT 'issue.created' AS kind, created_by AS actor_id, id AS issue_id, created_at AS at
             FROM issues WHERE workspace_id = w.id ORDER BY created_at DESC LIMIT 1)
          UNION ALL
          (SELECT 'comment.created', author_id, issue_id, created_at
             FROM comments WHERE workspace_id = w.id ORDER BY created_at DESC LIMIT 1)
          ORDER BY at DESC LIMIT 1
        ) l
        JOIN issues i ON i.id = l.issue_id
        LEFT JOIN users u ON u.id = l.actor_id`),

        db
          .select({
            id: issues.id,
            workspaceId: issues.workspaceId,
            workspaceName: workspaces.name,
            key: sql<string>`${projects.key} || '-' || ${issues.number}`,
            title: issues.title,
            status: issues.status,
            updatedAt: issues.updatedAt,
          })
          .from(issues)
          .innerJoin(projects, eq(projects.id, issues.projectId))
          .innerJoin(workspaces, eq(workspaces.id, issues.workspaceId))
          .where(assignedToMe)
          // Created in the same millisecond, the later number is the newer.
          .orderBy(desc(issues.updatedAt), desc(issues.number))
          .limit(ASSIGNED_SHOWN),

        // The list stops at five; the count the home says out loud does not.
        db.select({ n: sql<number>`count(*)::int` }).from(issues).where(assignedToMe),
      ]);

      const openBy = new Map(open.map((row) => [row.workspaceId, row.n]));
      // How much each owned workspace stores, for its owners only (stage 1,
      // item 11); nobody else is shown it.
      const owned = mine.filter((w) => w.role === 'OWNER').map((w) => w.id);
      const stored =
        owned.length === 0
          ? []
          : await db
              .select({
                workspaceId: attachments.workspaceId,
                used: sql<number>`coalesce(sum(${attachments.bytes}), 0)::bigint`,
              })
              .from(attachments)
              .where(inArray(attachments.workspaceId, owned))
              .groupBy(attachments.workspaceId);
      const usedBy = new Map(stored.map((row) => [row.workspaceId, Number(row.used)]));
      const storageBy = new Map(
        owned.map((id) => [
          id,
          { used: usedBy.get(id) ?? 0, quota: WORKSPACE_STORAGE_QUOTA_BYTES },
        ]),
      );
      const latestBy = new Map([...latest].map((row) => [row.workspaceId, row]));

      return {
        workspaces: ids.map((id) => {
          const shown = [...members].filter((m) => m.workspaceId === id);
          const days = Array<number>(ACTIVITY_DAYS).fill(0);
          for (const row of activity) {
            if (row.workspaceId === id) days[ACTIVITY_DAYS - 1 - row.daysAgo] = row.n;
          }
          const last = latestBy.get(id);
          return {
            id,
            openIssues: openBy.get(id) ?? 0,
            storage: storageBy.get(id) ?? null,
            memberCount: shown[0]?.total ?? 0,
            members: shown.map((m) => ({
              id: m.userId,
              name: m.name,
              avatar: avatarOf({
                id: m.userId,
                avatarKind: m.avatarKind,
                avatarRef: m.avatarRef,
                avatarUpdatedAt: m.avatarUpdatedAt ? new Date(m.avatarUpdatedAt) : null,
              }),
            })),
            activity: days,
            latest: last
              ? {
                  kind: last.kind,
                  actorName: last.actorName,
                  issueId: last.issueId,
                  issueTitle: last.issueTitle,
                  at: new Date(last.at).toISOString(),
                }
              : null,
          };
        }),
        assigned,
        assignedTotal: assignedCount?.n ?? 0,
      };
    },
  );
}
