/**
 * Populate the dev database with a workspace you can actually click through.
 *
 * Idempotent: re-running wipes the seeded rows first, so it is safe to use as a
 * "put things back how they were" button during development.
 *
 *   bun run db:seed           just the owner account
 *   bun run db:seed --team    plus four teammates, for multi-user demos
 *
 * The default is a single account. The `--team` roster exists because presence,
 * live collaboration and the role model are only observable with more than one
 * person -- there is nothing to see in a permission matrix when every session is
 * the same owner.
 */
import { hashPassword } from '@robis/auth';
import {
  channels,
  createDatabase,
  issues,
  meetingAttendees,
  meetings,
  messages,
  projects,
  recordAudit,
  users,
  workspaceMembers,
  workspaces,
} from '@robis/database';
import { type IssuePriority, type IssueStatus, type Role, slugify } from '@robis/shared';
import { eq, inArray } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://robis:robis@localhost:5433/robis';
const PASSWORD = process.env.SEED_PASSWORD ?? 'robis-demo-password';

const WITH_TEAM = process.argv.includes('--team');

type Person = { email: string; name: string; role: Role };

const OWNER: Person = { email: 'rohit@robis.test', name: 'Rohit Biju', role: 'OWNER' };

/** Only created with `--team`. */
const TEAM: Person[] = [
  { email: 'alex@robis.test', name: 'Alex Rivera', role: 'ADMIN' },
  { email: 'john@robis.test', name: 'John Okafor', role: 'MEMBER' },
  { email: 'mia@robis.test', name: 'Mia Lindqvist', role: 'GUEST' },
];

const PEOPLE: Person[] = WITH_TEAM ? [OWNER, ...TEAM] : [OWNER];

type IssueSpec = {
  title: string;
  status: IssueStatus;
  priority: IssuePriority;
  /** Only honoured when that person exists; otherwise the issue is unassigned. */
  assignee?: string;
};

const PROJECTS: { key: string; name: string; description: string; issues: IssueSpec[] }[] = [
  {
    key: 'REL',
    name: 'Web App',
    description: 'The Robis client.',
    issues: [
      {
        title: 'Fix OAuth refresh-token bug',
        status: 'TODO',
        priority: 'URGENT',
        assignee: OWNER.email,
      },
      { title: 'Reproduce Safari authentication issue', status: 'TODO', priority: 'HIGH' },
      {
        title: 'Search across issues and documents',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        assignee: OWNER.email,
      },
      { title: 'Keyboard shortcuts for the board', status: 'IN_PROGRESS', priority: 'LOW' },
      {
        title: 'Billing settings page',
        status: 'IN_REVIEW',
        priority: 'MEDIUM',
        assignee: 'alex@robis.test',
      },
      { title: 'Dark mode', status: 'DONE', priority: 'LOW', assignee: OWNER.email },
    ],
  },
  {
    key: 'API',
    name: 'Backend',
    description: 'Fastify service and Postgres schema.',
    issues: [
      {
        title: 'Rate limit the auth endpoints',
        status: 'TODO',
        priority: 'HIGH',
        assignee: OWNER.email,
      },
      { title: 'Audit log retention policy', status: 'TODO', priority: 'NONE' },
      {
        title: 'Cursor pagination for issue lists',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        assignee: 'john@robis.test',
      },
      { title: 'Session cleanup job', status: 'DONE', priority: 'LOW' },
    ],
  },
];

const WORKSPACE_NAME = 'Engineering';

const CHANNELS: { name: string; topic: string }[] = [
  { name: 'general', topic: 'Anything that does not belong anywhere else.' },
  { name: 'offline-sync', topic: 'The mutation queue and the idempotency ledger.' },
  { name: 'design-review', topic: 'Before it ships.' },
];

/**
 * A short thread, written backwards from now.
 *
 * Deliberately about the actual work in the seeded issues, so the screenshot
 * reads as one coherent workspace rather than placeholder chatter sitting
 * beside unrelated tickets.
 */
const CONVERSATION: { channel: string; from: string; minutesAgo: number; body: string }[] = [
  {
    channel: 'offline-sync',
    from: 'alex@robis.test',
    minutesAgo: 1_510,
    body: 'The replay test is green. Queue drains in order after a 40 second disconnect.',
  },
  {
    channel: 'offline-sync',
    from: 'rohit@robis.test',
    minutesAgo: 1_495,
    body: 'Good. Did you check the ambiguous case, where the response is lost but the write landed?',
  },
  {
    channel: 'offline-sync',
    from: 'alex@robis.test',
    minutesAgo: 1_480,
    body: 'Yes. Second attempt finds the ledger row and returns the stored response instead of inserting again.',
  },
  {
    channel: 'offline-sync',
    from: 'john@robis.test',
    minutesAgo: 184,
    body: 'Reading through this now. Is the ledger key per user, or global?',
  },
  {
    channel: 'offline-sync',
    from: 'alex@robis.test',
    minutesAgo: 176,
    body: 'Global key, but the user id is checked too, so one account cannot probe another’s.',
  },
  {
    channel: 'offline-sync',
    from: 'rohit@robis.test',
    minutesAgo: 41,
    body: 'Let us walk through the fan-out numbers at standup. p50 to all 50 subscribers is 5.8ms, which I did not expect.',
  },
  {
    channel: 'general',
    from: 'mia@robis.test',
    minutesAgo: 95,
    body: 'The 404-for-non-members behaviour caught me out in testing. Then I read the comment and it is obviously right.',
  },
  {
    channel: 'general',
    from: 'rohit@robis.test',
    minutesAgo: 88,
    body: 'That one is worth keeping. A 403 tells you the workspace exists, which is half of what an attacker wants.',
  },
];

const MEETINGS: {
  title: string;
  agenda: string;
  hoursAhead: number;
  durationMinutes: number;
}[] = [
  {
    title: 'Sync protocol walkthrough',
    agenda: 'Queue ordering, the idempotency ledger, and what happens on a partial drain.',
    hoursAhead: 3,
    durationMinutes: 45,
  },
  {
    title: 'Board drag and drop review',
    agenda: 'Pointer handling and what the optimistic update should do when the write fails.',
    hoursAhead: 27,
    durationMinutes: 30,
  },
];

const { db, close } = createDatabase(DATABASE_URL);

try {
  // Clear every account this script can create, not just the ones it is about
  // to create, so switching between solo and --team leaves nothing behind.
  const seedEmails = [OWNER, ...TEAM].map((person) => person.email);

  // Workspaces cascade to projects and issues; users are deleted after, because
  // `created_by` is ON DELETE RESTRICT.
  await db.delete(workspaces).where(eq(workspaces.slug, slugify(WORKSPACE_NAME)));
  await db.delete(users).where(inArray(users.email, seedEmails));

  const passwordHash = await hashPassword(PASSWORD);

  const createdUsers = await db
    .insert(users)
    .values(PEOPLE.map((person) => ({ email: person.email, name: person.name, passwordHash })))
    .returning({ id: users.id, email: users.email });

  const userIdByEmail = new Map(createdUsers.map((user) => [user.email, user.id]));
  const ownerId = userIdByEmail.get(OWNER.email)!;

  const [workspace] = await db
    .insert(workspaces)
    .values({ name: WORKSPACE_NAME, slug: slugify(WORKSPACE_NAME), createdBy: ownerId })
    .returning();

  await db.insert(workspaceMembers).values(
    PEOPLE.map((person) => ({
      workspaceId: workspace!.id,
      userId: userIdByEmail.get(person.email)!,
      role: person.role,
    })),
  );

  let issueCount = 0;

  /** Collected as rows are created, inserted in one go below. */
  const trail: {
    entityType: string;
    entityId: string;
    eventType: string;
    payload: string;
  }[] = [
    {
      entityType: 'workspace',
      entityId: workspace!.id,
      eventType: 'workspace.created',
      payload: JSON.stringify({ name: workspace!.name, slug: workspace!.slug }),
    },
    ...PEOPLE.filter((person) => person.email !== OWNER.email).map((person) => ({
      entityType: 'member',
      entityId: userIdByEmail.get(person.email)!,
      eventType: 'member.added',
      payload: JSON.stringify({ email: person.email, name: person.name, role: person.role }),
    })),
  ];

  for (const spec of PROJECTS) {
    const [project] = await db
      .insert(projects)
      .values({
        workspaceId: workspace!.id,
        key: spec.key,
        name: spec.name,
        description: spec.description,
        issueCounter: spec.issues.length,
        createdBy: ownerId,
      })
      .returning();

    const createdIssues = await db
      .insert(issues)
      .values(
        spec.issues.map((issue, index) => ({
          workspaceId: workspace!.id,
          projectId: project!.id,
          number: index + 1,
          title: issue.title,
          status: issue.status,
          priority: issue.priority,
          // Falls back to unassigned when seeding solo and the named teammate
          // does not exist.
          assigneeId: (issue.assignee && userIdByEmail.get(issue.assignee)) ?? null,
          createdBy: ownerId,
        })),
      )
      .returning({ id: issues.id, number: issues.number, title: issues.title });

    /*
     * Audit entries for the seeded rows.
     *
     * The seed writes tables directly rather than going through the API, so
     * nothing would otherwise record that any of this happened -- the activity
     * feed on a freshly seeded workspace would be empty, which misrepresents
     * what the app does. These are written by hand to match what the routes
     * would have produced.
     */
    trail.push(
      {
        entityType: 'project',
        entityId: project!.id,
        eventType: 'project.created',
        payload: JSON.stringify({ key: project!.key, name: project!.name }),
      },
      ...createdIssues.map((issue) => ({
        entityType: 'issue',
        entityId: issue.id,
        eventType: 'issue.created',
        payload: JSON.stringify({ key: `${spec.key}-${issue.number}`, title: issue.title }),
      })),
    );

    issueCount += spec.issues.length;
  }

  // Through `recordAudit`, like the routes, so the seeded rows form a valid
  // hash chain rather than rows a verifier would reject.
  await db.transaction(async (tx) => {
    for (const entry of trail) {
      await recordAudit(
        tx,
        { id: ownerId, kind: 'human' },
        { ...entry, workspaceId: workspace!.id, payload: JSON.parse(entry.payload) },
      );
    }
  });

  /*
   * Chat and meetings.
   *
   * Seeded last because both need the member ids, and seeded at all because
   * an empty centre column misrepresents the product -- the shell is built
   * around a conversation, and a screenshot of it with no messages shows a
   * layout rather than a thing anyone would use.
   *
   * Timestamps are spread backwards from now so the transcript has a shape:
   * a day separator, a couple of grouped runs from one person, and a gap.
   */
  const roster = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      inArray(
        users.email,
        PEOPLE.map((person) => person.email),
      ),
    );

  const idByEmail = new Map(roster.map((row) => [row.email, row.id]));
  const personId = (email: string) => idByEmail.get(email) ?? ownerId;

  const createdChannels = await db
    .insert(channels)
    .values(
      CHANNELS.map((channel) => ({
        workspaceId: workspace!.id,
        name: channel.name,
        topic: channel.topic,
        createdById: ownerId,
      })),
    )
    .returning({ id: channels.id, name: channels.name });

  const channelByName = new Map(createdChannels.map((row) => [row.name, row.id]));

  const transcript = CONVERSATION.filter(
    // A message from a teammate who was never created would violate the
    // author foreign key, so without `--team` the thread is just the owner.
    (line) => WITH_TEAM || line.from === OWNER.email,
  );

  if (transcript.length > 0) {
    await db.insert(messages).values(
      transcript.map((line) => ({
        workspaceId: workspace!.id,
        channelId: channelByName.get(line.channel) ?? createdChannels[0]!.id,
        authorId: personId(line.from),
        body: line.body,
        createdAt: new Date(Date.now() - line.minutesAgo * 60_000),
      })),
    );
  }

  const scheduled = await db
    .insert(meetings)
    .values(
      MEETINGS.map((meeting) => ({
        workspaceId: workspace!.id,
        title: meeting.title,
        agenda: meeting.agenda,
        startsAt: new Date(Date.now() + meeting.hoursAhead * 3_600_000),
        durationMinutes: meeting.durationMinutes,
        organizerId: ownerId,
      })),
    )
    .returning({ id: meetings.id });

  await db.insert(meetingAttendees).values(
    scheduled.flatMap((meeting) => [
      { meetingId: meeting.id, userId: ownerId, response: 'yes' as const, respondedAt: new Date() },
      ...roster
        .filter((person) => person.id !== ownerId)
        .map((person, index) => ({
          meetingId: meeting.id,
          userId: person.id,
          // A mix, so the "2 of 4 going" line has something to say.
          response: (['yes', 'pending', 'maybe'] as const)[index % 3]!,
        })),
    ]),
  );

  const who = WITH_TEAM ? `${PEOPLE.length} users` : '1 user';
  console.log(
    `Seeded "${WORKSPACE_NAME}": ${who}, ${PROJECTS.length} projects, ${issueCount} issues.`,
  );
  console.log(`Sign in as ${OWNER.email} with password "${PASSWORD}".`);

  if (!WITH_TEAM) {
    console.log('Run with --team to add teammates for presence and role demos.');
  }
} finally {
  await close();
}
