import {
  type AuditActor,
  channels,
  cycles,
  type Database,
  documents,
  issueBlocks,
  issues,
  issueTemplates,
  meetings,
  projects,
  projectUpdates,
  recordAudit,
  recurringIssues,
  releases,
  type Tx,
  textSnapshot,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import {
  addDays,
  canonicalZone,
  DEMO_WORKSPACE,
  demoMeetingStart,
  nextRunAfter,
  wallOf,
} from '@robis/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
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

/** The demo's board and its example issues, with each issue's id by title. */
async function fillBoard(tx: Tx, actor: AuditActor, owner: Owner, workspaceId: string) {
  const project = await insertProject(tx, actor, {
    workspaceId,
    user: owner,
    input: { name: DEMO_WORKSPACE.project },
  });
  const ids = new Map<string, string>();
  // Last first, so the board reads them in order from the top.
  for (const issue of [...DEMO_WORKSPACE.issues].reverse()) {
    const filed = await fileIssue(tx, actor, {
      user: owner,
      workspaceId,
      projectId: project.id,
      input: issue,
    });
    ids.set(issue.title, filed.id);
  }
  return { projectId: project.id, ids };
}

/** Two weeks from today on the maker's clock, with the work not yet done in it. */
async function planDemoCycle(
  tx: Tx,
  owner: Owner,
  workspaceId: string,
  board: Awaited<ReturnType<typeof fillBoard>>,
  zone: string,
  now: Date,
) {
  const today = wallOf(now, zone);
  const day = (wall: { year: number; month: number; day: number }) =>
    `${wall.year}-${String(wall.month).padStart(2, '0')}-${String(wall.day).padStart(2, '0')}`;
  const [cycle] = await tx
    .insert(cycles)
    .values({
      workspaceId,
      projectId: board.projectId,
      name: DEMO_WORKSPACE.cycle.name,
      startsOn: day(today),
      endsOn: day(addDays(today, DEMO_WORKSPACE.cycle.days - 1)),
      timeZone: zone,
      createdBy: owner.id,
    })
    .returning({ id: cycles.id });
  const planned = DEMO_WORKSPACE.issues
    .filter((issue) => issue.status !== 'DONE')
    .flatMap((issue) => board.ids.get(issue.title) ?? []);
  if (planned.length > 0) {
    await tx.update(issues).set({ cycleId: cycle!.id }).where(inArray(issues.id, planned));
  }
}

/** A release three weeks out on the maker's clock, carrying some of the board's work. */
async function planDemoRelease(
  tx: Tx,
  owner: Owner,
  workspaceId: string,
  board: Awaited<ReturnType<typeof fillBoard>>,
  zone: string,
  now: Date,
) {
  const aimed = addDays(wallOf(now, zone), DEMO_WORKSPACE.release.days);
  const [release] = await tx
    .insert(releases)
    .values({
      workspaceId,
      name: DEMO_WORKSPACE.release.name,
      targetOn: `${aimed.year}-${String(aimed.month).padStart(2, '0')}-${String(aimed.day).padStart(2, '0')}`,
      createdBy: owner.id,
    })
    .returning({ id: releases.id });
  const carried = DEMO_WORKSPACE.release.issues.flatMap((title) => board.ids.get(title) ?? []);
  if (carried.length > 0) {
    await tx.update(issues).set({ releaseId: release!.id }).where(inArray(issues.id, carried));
  }
}

/**
 * The board as a team would have it after a while: its own word on how it
 * is going, one issue waiting on another, and a weekly check filed for it.
 */
async function fillBoardExtras(
  tx: Tx,
  actor: AuditActor,
  owner: Owner,
  workspaceId: string,
  board: Awaited<ReturnType<typeof fillBoard>>,
  zone: string,
  now: Date,
) {
  const { update, blocks, repeat } = DEMO_WORKSPACE;
  await tx.insert(projectUpdates).values({
    workspaceId,
    projectId: board.projectId,
    authorId: owner.id,
    health: update.health,
    body: update.body,
  });
  for (const link of blocks) {
    const blockedId = board.ids.get(link.blocked);
    const blockerId = board.ids.get(link.blocker);
    if (!blockedId || !blockerId) continue;
    await tx.insert(issueBlocks).values({ blockedId, blockerId, workspaceId, createdBy: owner.id });
  }
  const schedule = {
    cadence: repeat.cadence,
    weekday: repeat.weekday,
    monthDay: null,
    hour: repeat.hour,
    timeZone: zone,
  };
  await tx.insert(recurringIssues).values({
    workspaceId,
    projectId: board.projectId,
    title: repeat.title,
    priority: repeat.priority,
    ...schedule,
    nextRunAt: nextRunAfter(schedule, now),
    createdBy: owner.id,
  });
  await planDemoCycle(tx, owner, workspaceId, board, zone, now);
  await planDemoRelease(tx, owner, workspaceId, board, zone, now);
  await tx
    .insert(issueTemplates)
    .values({ workspaceId, ...DEMO_WORKSPACE.template, createdBy: owner.id });
  await recordAudit(tx, actor, {
    workspaceId,
    entityType: 'project',
    entityId: board.projectId,
    eventType: 'project.demo_filled',
    payload: {
      update: true,
      blocks: blocks.length,
      repeats: 1,
      cycles: 1,
      releases: 1,
      templates: 1,
    },
  });
}

async function fillDemo(
  tx: Tx,
  actor: AuditActor,
  owner: Owner,
  workspaceId: string,
  zone: string,
  now: Date,
) {
  const board = await fillBoard(tx, actor, owner, workspaceId);
  await fillBoardExtras(tx, actor, owner, workspaceId, board, zone, now);

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
  const made = await insertMeeting(
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
  await tx
    .update(meetings)
    .set({ notes: meeting.notes, notesUpdatedAt: now, notesUpdatedBy: owner.id })
    .where(eq(meetings.id, made.id));

  return board.projectId;
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
        existing.projectId ?? (await fillBoard(tx, actor, owner, existing.workspace.id)).projectId;
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
