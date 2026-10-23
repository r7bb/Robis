/**
 * Two more demo workspaces beside Engineering, so the signed-in home has a
 * constellation rather than a single star: each in its own theme, with the
 * team in different roles, and issues spread over the last two weeks so
 * the activity sparklines have a shape. Used by `seed.ts`, on a fresh seed
 * and on `--if-missing`, which adds whichever of these is not there yet.
 */
import {
  channels,
  type Database,
  issues,
  projects,
  recordAudit,
  type Tx,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import {
  type IssuePriority,
  type IssueStatus,
  type Role,
  slugify,
  type ThemeId,
} from '@robis/shared';
import { eq } from 'drizzle-orm';

const DAY_MS = 24 * 60 * 60 * 1000;

type ExtraIssue = {
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  assignee: string;
  daysAgo: number;
};

type ExtraWorkspace = {
  name: string;
  theme: ThemeId;
  /** By email; the owner first. Anyone not seeded is skipped. */
  roles: Record<string, Role>;
  project: { key: string; name: string; description: string; issues: ExtraIssue[] };
};

export const EXTRA_WORKSPACES: readonly ExtraWorkspace[] = [
  {
    name: 'Design',
    theme: 'orchid',
    roles: {
      'rohit@robis.test': 'OWNER',
      'mia@robis.test': 'ADMIN',
      'alex@robis.test': 'MEMBER',
    },
    project: {
      key: 'DS',
      name: 'Design system',
      description: 'Tokens, components and the rules for using them.',
      issues: [
        {
          title: 'Audit colour contrast on the board',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          assignee: 'mia@robis.test',
          daysAgo: 1,
        },
        {
          title: 'Icon set for empty states',
          status: 'TODO',
          priority: 'MEDIUM',
          assignee: 'alex@robis.test',
          daysAgo: 3,
        },
        {
          title: 'Motion tokens for page transitions',
          status: 'IN_REVIEW',
          priority: 'MEDIUM',
          assignee: 'rohit@robis.test',
          daysAgo: 5,
        },
        {
          title: 'Dark theme for the document editor',
          status: 'TODO',
          priority: 'LOW',
          assignee: 'mia@robis.test',
          daysAgo: 9,
        },
        {
          title: 'Tidy the spacing scale',
          status: 'DONE',
          priority: 'LOW',
          assignee: 'alex@robis.test',
          daysAgo: 12,
        },
      ],
    },
  },
  {
    name: 'Launch',
    theme: 'ember',
    roles: {
      'rohit@robis.test': 'OWNER',
      'alex@robis.test': 'ADMIN',
      'john@robis.test': 'MEMBER',
      'mia@robis.test': 'GUEST',
    },
    project: {
      key: 'GTM',
      name: 'Public launch',
      description: 'Everything between a working app and people using it.',
      issues: [
        {
          title: 'Write the launch post',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
          assignee: 'rohit@robis.test',
          daysAgo: 0,
        },
        {
          title: 'Record the two-minute demo',
          status: 'TODO',
          priority: 'HIGH',
          assignee: 'alex@robis.test',
          daysAgo: 2,
        },
        {
          title: 'Review the pricing page copy',
          status: 'IN_REVIEW',
          priority: 'MEDIUM',
          assignee: 'john@robis.test',
          daysAgo: 4,
        },
        {
          title: 'Set up the status page',
          status: 'TODO',
          priority: 'MEDIUM',
          assignee: 'john@robis.test',
          daysAgo: 6,
        },
        {
          title: 'Press list for launch day',
          status: 'TODO',
          priority: 'LOW',
          assignee: 'rohit@robis.test',
          daysAgo: 8,
        },
        {
          title: 'Load test the sign-up flow',
          status: 'DONE',
          priority: 'HIGH',
          assignee: 'alex@robis.test',
          daysAgo: 11,
        },
      ],
    },
  },
];

/** Slugs the seed owns, so a full re-seed can clear them first. */
export const EXTRA_SLUGS = EXTRA_WORKSPACES.map((w) => slugify(w.name));

/** One workspace, everything in it, and its audit chain: run in one transaction. */
async function seedOne(
  db: Tx,
  spec: ExtraWorkspace,
  ownerId: string,
  idByEmail: ReadonlyMap<string, string>,
): Promise<number> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: spec.name, slug: slugify(spec.name), theme: spec.theme, createdBy: ownerId })
    .returning();
  const members = Object.entries(spec.roles).flatMap(([email, role]) => {
    const userId = idByEmail.get(email);
    return userId ? [{ workspaceId: workspace!.id, userId, role }] : [];
  });
  await db.insert(workspaceMembers).values(members);
  await db.insert(channels).values({
    workspaceId: workspace!.id,
    name: 'general',
    topic: 'Anything that does not belong anywhere else.',
    createdById: ownerId,
  });

  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: workspace!.id,
      key: spec.project.key,
      name: spec.project.name,
      description: spec.project.description,
      issueCounter: spec.project.issues.length,
      createdBy: ownerId,
    })
    .returning();
  const created = await db
    .insert(issues)
    .values(
      spec.project.issues.map((issue, index) => {
        const at = new Date(Date.now() - issue.daysAgo * DAY_MS);
        return {
          workspaceId: workspace!.id,
          projectId: project!.id,
          number: index + 1,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          assigneeId: idByEmail.get(issue.assignee) ?? null,
          createdBy: ownerId,
          createdAt: at,
          updatedAt: at,
        };
      }),
    )
    .returning({ id: issues.id, number: issues.number, title: issues.title });

  // Through `recordAudit`, like the routes, so the chain verifies.
  const actor = { id: ownerId, kind: 'human' as const };
  const entries = [
    {
      entityType: 'workspace',
      entityId: workspace!.id,
      eventType: 'workspace.created',
      payload: { name: workspace!.name, slug: workspace!.slug },
    },
    {
      entityType: 'project',
      entityId: project!.id,
      eventType: 'project.created',
      payload: { key: project!.key, name: project!.name },
    },
    ...created.map((issue) => ({
      entityType: 'issue',
      entityId: issue.id,
      eventType: 'issue.created',
      payload: { key: `${spec.project.key}-${issue.number}`, title: issue.title },
    })),
  ];
  for (const entry of entries) {
    await recordAudit(db, actor, { ...entry, workspaceId: workspace!.id });
  }
  return created.length;
}

/**
 * Create whichever demo workspaces do not exist yet. Returns their names.
 * Never touches one that exists, so it is safe on a stack someone has used.
 */
export async function seedExtraWorkspaces(
  db: Database,
  ownerId: string,
  idByEmail: ReadonlyMap<string, string>,
): Promise<string[]> {
  const made: string[] = [];
  for (const spec of EXTRA_WORKSPACES) {
    // All or nothing, so a failure halfway never leaves a workspace that a
    // later run would find and skip.
    const created = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, slugify(spec.name)))
        .limit(1);
      if (existing) return false;
      await seedOne(tx, spec, ownerId, idByEmail);
      return true;
    });
    if (created) made.push(spec.name);
  }
  return made;
}
