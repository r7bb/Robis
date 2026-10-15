import {
  type AuditInput,
  auditEvents,
  type Database,
  listAuditEvents,
  recordAudit,
  toExported,
  users,
  verifyAuditTrail,
  workspaceMembers,
} from '@robis/database';
import { auditEventsQuerySchema } from '@robis/shared';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { RateLimits } from '../app.ts';
import { ApiError } from '../errors.ts';
import { auditActor, currentMembership, requireAuth, requireMembership } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';
import { parse } from '../validate.ts';

/** Reads by one person within this window are recorded once. */
const READ_COALESCE_MS = 60_000;

/**
 * The smallest page a forward walk (an export) may ask for. Each page
 * appends one `audit.exported` event to the trail it is walking, so a walk
 * must consume more than one event per page to ever reach the end.
 */
export const MIN_EXPORT_PAGE = 10;

/** Pages of the trail per minute per person: a person reads, a loop does not. */
const READS_PER_MINUTE = 120;

/**
 * Refuse a cross-site page navigation.
 *
 * These reads append to the trail, and the session cookie is sent on a
 * top-level navigation from any site. Without this, a link elsewhere could
 * make an admin's browser record reads in the admin's name. Browsers say
 * where a request came from in `Sec-Fetch-*`; the app's own requests are
 * `fetch` calls from its origin, never navigations.
 */
const refuseCrossSiteNavigation: preHandlerHookHandler = async (request) => {
  const site = request.headers['sec-fetch-site'];
  const mode = request.headers['sec-fetch-mode'];
  if (site === 'cross-site' || mode === 'navigate') {
    throw ApiError.forbidden('Open the audit trail from the Security view');
  }
};

/**
 * The audit trail, for administrators and for export.
 *
 * Distinct from `/activity`, which every member sees and which is a feed: this
 * is the whole trail, keyset-paged so an exporter can walk it without gaps,
 * in the same wire shape the SIEM stream sends, plus a check of the chain.
 *
 * Looking at the trail is itself recorded: reads (once a minute per person),
 * each page exported, and each check, so who has been reading the record is
 * part of the record.
 */
export async function auditRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits },
) {
  const { db, limits } = opts;

  /** Append one `audit.*` event describing what the caller just looked at. */
  async function recordAccess(
    request: FastifyRequest,
    eventType: string,
    payload: AuditInput['payload'],
  ) {
    const { workspaceId } = currentMembership(request);
    const actor = auditActor(request);

    await db.transaction(async (tx) => {
      if (eventType === 'audit.read') {
        const [recent] = await tx
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.workspaceId, workspaceId),
              eq(auditEvents.actorId, actor.id!),
              eq(auditEvents.eventType, 'audit.read'),
              gt(auditEvents.createdAt, new Date(Date.now() - READ_COALESCE_MS)),
            ),
          )
          .limit(1);
        if (recent) return;
      }

      await recordAudit(tx, actor, {
        workspaceId,
        entityType: 'workspace',
        entityId: workspaceId,
        eventType,
        payload,
      });
    });
  }

  const readLimit = rateLimit({
    name: 'audit-read',
    limit: READS_PER_MINUTE,
    windowMs: 60_000,
  });

  const reader = [
    requireAuth,
    requireMembership(db, 'audit:read'),
    refuseCrossSiteNavigation,
    readLimit,
  ];

  app.get('/workspaces/:workspaceId/audit/events', { preHandler: reader }, async (request) => {
    const { workspaceId } = currentMembership(request);
    const query = parse(auditEventsQuerySchema, request.query);
    const exporting = query.after !== undefined;

    if (exporting && query.limit < MIN_EXPORT_PAGE) {
      throw ApiError.badRequest(
        `An export reads at least ${MIN_EXPORT_PAGE} events a page`,
        'page_too_small',
      );
    }

    const { rows, nextCursor } = await listAuditEvents(db, workspaceId, query);

    // Reading forwards from a cursor is how the export walks the trail;
    // newest first is a person reading it.
    await recordAccess(request, exporting ? 'audit.exported' : 'audit.read', {
      count: rows.length,
      ...(exporting ? { after: query.after } : {}),
      ...(query.before !== undefined ? { before: query.before } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    });

    // Names are looked up for the page rather than joined, and only for
    // display: the exported identity is the id, which does not change when
    // someone renames themselves.
    const actorIds = [...new Set(rows.flatMap((row) => (row.actorId ? [row.actorId] : [])))];
    const names =
      actorIds.length > 0
        ? await db
            .select({ id: users.id, name: users.name })
            .from(users)
            .where(inArray(users.id, actorIds))
        : [];
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    return {
      events: rows.map((row) => ({
        ...toExported(row),
        actorName: row.actorId ? (nameById.get(row.actorId) ?? null) : null,
      })),
      nextCursor,
    };
  });

  /**
   * Everyone who appears in the trail, for the "who" filter.
   *
   * From the trail rather than the member list, so someone who has left or
   * been removed can still be picked: their events are still there, and are
   * often the ones being looked for. Named by username. Counts as a read.
   */
  app.get('/workspaces/:workspaceId/audit/actors', { preHandler: reader }, async (request) => {
    const { workspaceId } = currentMembership(request);

    const rows = await db
      .selectDistinct({
        id: auditEvents.actorId,
        username: users.username,
        name: users.name,
        member: sql<boolean>`${workspaceMembers.userId} is not null`,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .leftJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, auditEvents.actorId),
        ),
      )
      .where(and(eq(auditEvents.workspaceId, workspaceId), isNotNull(auditEvents.actorId)));

    await recordAccess(request, 'audit.read', { list: 'actors' });

    const actors = rows
      .map((row) => ({
        id: row.id!,
        username: row.username,
        name: row.name,
        former: !row.member,
      }))
      .sort((a, b) =>
        a.former === b.former
          ? (a.username ?? a.id).localeCompare(b.username ?? b.id)
          : a.former
            ? 1
            : -1,
      );

    return { actors };
  });

  const verifyLimit = rateLimit({
    name: 'audit-verify',
    limit: limits.auditVerifyPerMinute,
    windowMs: 60_000,
  });
  const fullVerifyLimit = rateLimit({
    name: 'audit-verify-full',
    limit: limits.auditFullVerifyPerMinute,
    windowMs: 60_000,
  });

  /**
   * Check the chain. A POST, because it writes: the check moves the
   * checkpoint and is itself recorded, and a cross-site form cannot send the
   * session cookie with one.
   */
  app.post(
    '/workspaces/:workspaceId/audit/verify',
    {
      preHandler: [
        requireAuth,
        requireMembership(db, 'audit:read'),
        // From the checkpoint, a check walks only what is new. A full one
        // hashes every event there is, so it has a much smaller budget.
        async function limitByKind(this: FastifyInstance, request, reply) {
          const { full } = request.query as { full?: string };
          const limiter = full === '1' ? fullVerifyLimit : verifyLimit;
          await limiter.call(this, request, reply, () => {});
        },
      ],
    },
    async (request) => {
      const { workspaceId } = currentMembership(request);
      const { full } = request.query as { full?: string };

      const report = await verifyAuditTrail(db, workspaceId, { full: full === '1' });
      await recordAccess(request, 'audit.verified', {
        ok: report.ok,
        full: full === '1',
        checked: report.checked,
        fromSeq: report.fromSeq,
        // Kept, because a rejected or stale checkpoint is the one sign of a
        // change made to it, and the next clean check replaces the row.
        checkpoint: report.checkpoint,
        ...(report.broken ? { reason: report.broken.reason, seq: report.broken.seq } : {}),
      });
      return report;
    },
  );
}
