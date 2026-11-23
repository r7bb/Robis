import { type AuditActor, meetingAttendees, meetings, recordAudit, type Tx } from '@robis/database';
import { lastStartOf } from './schedule.ts';

/**
 * A new meeting and its attendees, audited, in the caller's transaction:
 * the one way a meeting is made, whether scheduled or imported (B8).
 * Invitees must already be intersected with the workspace's roster.
 */
export type NewMeetingRow = {
  title: string;
  agenda: string | null;
  startsAt: Date;
  durationMinutes: number;
  joinUrl: string | null;
  timeZone: string;
  repeatCount: number | null;
};

export async function insertMeeting(
  tx: Tx,
  actor: AuditActor & { id: string },
  workspaceId: string,
  input: NewMeetingRow,
  inviteeIds: readonly string[],
  source: 'scheduled' | 'imported' = 'scheduled',
) {
  const [meeting] = await tx
    .insert(meetings)
    .values({
      workspaceId,
      ...input,
      organizerId: actor.id,
      lastStartsAt: lastStartOf(input),
    })
    .returning();

  // The organiser attends their own meeting, already answered. Anyone else
  // starts at `pending`, which is a real state: "not replied" is not the
  // same as "declined".
  await tx
    .insert(meetingAttendees)
    .values([
      { meetingId: meeting!.id, userId: actor.id, response: 'yes', respondedAt: new Date() },
      ...inviteeIds
        .filter((id) => id !== actor.id)
        .map((userId) => ({ meetingId: meeting!.id, userId })),
    ]);

  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'meeting',
    entityId: meeting!.id,
    eventType: 'meeting.created',
    payload: {
      title: meeting!.title,
      startsAt: meeting!.startsAt.toISOString(),
      invited: inviteeIds.filter((id) => id !== actor.id).length,
      ...(source === 'imported' ? { source } : {}),
    },
  });
  return meeting!;
}
