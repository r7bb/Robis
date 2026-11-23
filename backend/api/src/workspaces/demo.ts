import {
  type AuditActor,
  channels,
  type Database,
  documents,
  projects,
  recordAudit,
  type Tx,
  textSnapshot,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { canonicalZone, DEMO_WORKSPACE, demoMeetingStart } from '@robis/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { insertMeeting } from '../meetings/create.ts';
import { fileIssue } from '../routes/issues.ts';
import { insertProject } from '../routes/projects.ts';
import { insertWorkspace } from './create.ts';

/**
 * The demo workspace (C5): example work to look around, made in one
 * transaction as the person who asked, so every row is theirs and the
 * trail says so. Asking again returns the demo already owned rather than
 * a pile of them.
 */

type Owner = { id: string; kind: string };

/**
 * The demo this person made and still belongs to, with its first board if
 * one is left. Found by who made it rather than through its boards, so a
 * demo whose board was deleted is found too, and given a new board.
 */
async function existingDemo(tx: Tx, userId: string) {
  const [row] = await tx
    .select({ workspace: workspaces, projectId: projects.id })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
    )
    .leftJoin(projects, eq(projects.workspaceId, workspaces.id))
    .where(and(eq(workspaces.demo, true), eq(workspaces.createdBy, userId)))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  return row ?? null;
}

/** The demo's board and its example issues. */
async function fillBoard(tx: Tx, actor: AuditActor, owner: Owner, workspaceId: string) {
  const project = await insertProject(tx, actor, {
    workspaceId,
    user: owner,
    input: { name: DEMO_WORKSPACE.project },
  });
  // Last first, so the board reads them in order from the top.
  for (const issue of [...DEMO_WORKSPACE.issues].reverse()) {
    await fileIssue(tx, actor, { user: owner, workspaceId, projectId: project.id, input: issue });
  }
  return project.id;
}

async function fillDemo(
  tx: Tx,
  actor: AuditActor,
  owner: Owner,
  workspaceId: string,
  zone: string,
  now: Date,
) {
  const projectId = await fillBoard(tx, actor, owner, workspaceId);

  const { title, body } = DEMO_WORKSPACE.document;
  const [document] = await tx
    .insert(documents)
    .values({
      workspaceId,
      title,
      snapshot: textSnapshot(body),
      searchText: body,
      createdBy: owner.id,
    })
    .returning({ id: documents.id });
  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'document',
    entityId: document!.id,
    eventType: 'document.created',
    payload: { title },
  });

  const [channel] = await tx
    .insert(channels)
    .values({ workspaceId, ...DEMO_WORKSPACE.channel, createdById: owner.id })
    .returning({ id: channels.id, name: channels.name });
  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'channel',
    entityId: channel!.id,
    eventType: 'channel.created',
    payload: { name: channel!.name },
  });

  const { meeting } = DEMO_WORKSPACE;
  await insertMeeting(
    tx,
    { ...actor, id: owner.id },
    workspaceId,
    {
      title: meeting.title,
      agenda: meeting.agenda,
      startsAt: demoMeetingStart(now, zone),
      durationMinutes: meeting.durationMinutes,
      joinUrl: null,
      timeZone: zone,
      repeatCount: null,
    },
    [],
  );

  return projectId;
}

export async function createDemoWorkspace(
  db: Database,
  actor: AuditActor,
  owner: Owner,
  { timeZone, now = new Date() }: { timeZone?: string; now?: Date },
) {
  const zone = (timeZone && canonicalZone(timeZone)) || 'UTC';
  return db.transaction(async (tx) => {
    // One at a time per person, so a double click or a second tab waits
    // for the first and then finds its demo rather than making another.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`demo-workspace:${owner.id}`}))`);
    const existing = await existingDemo(tx, owner.id);
    if (existing) {
      const projectId =
        existing.projectId ?? (await fillBoard(tx, actor, owner, existing.workspace.id));
      return { workspace: existing.workspace, projectId };
    }
    const workspace = await insertWorkspace(tx, actor, owner.id, {
      name: DEMO_WORKSPACE.name,
      demo: true,
    });
    const projectId = await fillDemo(tx, actor, owner, workspace.id, zone, now);
    return { workspace, projectId };
  });
}
