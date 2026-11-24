import { type Database, meetingAttendees, meetings, recordAudit, users } from '@robis/database';
import { can, contracts, isUuid } from '@robis/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import {
  auditActor,
  currentMembership,
  currentUser,
  requireAuth,
  requireMembership,
} from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

/** Saves a person may make in a minute: notes are saved as they are written. */
const SAVES_PER_MINUTE = 30;

/**
 * Meeting notes. Everyone who may read the meeting reads them; whoever is in
 * it (organiser or attendee), or may manage any meeting, writes them. A save
 * names when the notes it replaces were saved, and one made over a newer
 * save is refused with the newer notes, so two writers never silently
 * undo each other.
 */
export async function meetingNotesRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;
  const saveLimit = rateLimit({ name: 'meeting-notes', limit: SAVES_PER_MINUTE, windowMs: 60_000 });

  async function notesOf(request: FastifyRequest, meetingId: string) {
    const { workspaceId, role } = currentMembership(request);
    const me = currentUser(request).id;
    if (!isUuid(meetingId)) throw ApiError.notFound('Meeting not found');
    const [row] = await db
      .select({
        id: meetings.id,
        organizerId: meetings.organizerId,
        notes: meetings.notes,
        updatedAt: meetings.notesUpdatedAt,
        updatedByName: users.name,
      })
      .from(meetings)
      .leftJoin(users, eq(users.id, meetings.notesUpdatedBy))
      .where(and(eq(meetings.id, meetingId), eq(meetings.workspaceId, workspaceId)));
    if (!row) throw ApiError.notFound('Meeting not found');
    const [attending] = await db
      .select({ userId: meetingAttendees.userId })
      .from(meetingAttendees)
      .where(and(eq(meetingAttendees.meetingId, row.id), eq(meetingAttendees.userId, me)));
    const canEdit = row.organizerId === me || Boolean(attending) || can(role, 'meeting:manage_any');
    return {
      id: row.id,
      wire: {
        notes: row.notes,
        updatedAt: row.updatedAt,
        updatedByName: row.updatedAt ? (row.updatedByName ?? null) : null,
        canEdit,
      },
    };
  }

  serve(
    app,
    contracts['meetings.notes'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read')] },
    async (request, { params: { meetingId } }) => (await notesOf(request, meetingId)).wire,
  );

  serve(
    app,
    contracts['meetings.saveNotes'],
    { preHandler: [requireAuth, requireMembership(db, 'meeting:read'), saveLimit] },
    async (request, { params: { meetingId }, body }) => {
      const { workspaceId } = currentMembership(request);
      const current = await notesOf(request, meetingId);
      if (!current.wire.canEdit) {
        throw ApiError.forbidden('Only people in this meeting write its notes');
      }
      const now = new Date();
      // The check and the save are one statement: of two saves made at once
      // from the same notes, the second finds them changed.
      const unchanged =
        body.basedOn === undefined
          ? undefined
          : sql`${meetings.notesUpdatedAt} is not distinct from ${body.basedOn}`;
      await db.transaction(async (tx) => {
        const saved = await tx
          .update(meetings)
          .set({ notes: body.notes, notesUpdatedAt: now, notesUpdatedBy: currentUser(request).id })
          .where(and(eq(meetings.id, current.id), unchanged))
          .returning({ id: meetings.id });
        if (saved.length === 0) {
          throw ApiError.conflict(
            'These notes changed since you opened them. Copy what you wrote, reload and add it again.',
            'notes_changed',
          );
        }
        // What changed, not what it says: the notes stay in the meeting.
        await recordAudit(tx, auditActor(request), {
          workspaceId,
          entityType: 'meeting',
          entityId: current.id,
          eventType: 'meeting.notes_saved',
          payload: { length: body.notes.length },
        });
      });
      return (await notesOf(request, meetingId)).wire;
    },
  );
}
