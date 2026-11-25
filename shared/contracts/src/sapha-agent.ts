import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from './domain.ts';
import { type SaphaParts, saphaPartsSchema } from './sapha.ts';

/**
 * Sapha, the agent: a conversation in which Sapha looks things up for the
 * person, as them, in a few steps, and answers. What it may look at is
 * these tools and nothing else, each read inside the person's workspace
 * with their access. It cannot change anything: `propose` only checks a
 * change and puts it on a card, for the person to say yes to, as before.
 */

/** Steps it may take before it must answer: a few lookups, never a long hunt. */
export const SAPHA_AGENT_STEPS = 8;
/** Calls one step may make; more are refused, so one step cannot run up the cost. */
export const SAPHA_CALLS_PER_STEP = 4;
/** Changes one answer may propose. */
export const SAPHA_PROPOSALS_PER_ANSWER = 5;
/** What a person may type in one turn. */
export const SAPHA_TURN_CHARS = 1000;
/** Turns a person may ask of Sapha in a day, each a paid call or several. */
export const SAPHA_TURNS_PER_DAY = 60;
/** How long a conversation is kept after its last turn. */
export const SAPHA_KEPT_DAYS = 30;

const board = z.string().trim().max(80).nullable().optional();
const maybe = <T extends z.ZodType>(type: T) => type.nullable().optional();

/** The changes Sapha may propose; questions it answers itself. */
const CHANGE_KINDS = [
  'status',
  'priority',
  'assign',
  'unassign',
  'due',
  'create',
  'template',
  'plan',
  'unplan',
  'newCycle',
  'newRelease',
  'newBoard',
  'remind',
  'schedule',
] as const;

/**
 * A change, as `propose` takes it: only the change kinds, and every part but
 * the kind left out when unused, which a small model fills in more surely
 * than ten nulls.
 */
const proposeSchema = z.object({
  kind: z.enum(CHANGE_KINDS),
  issueKey: maybe(z.string().max(24)),
  status: maybe(z.enum(ISSUE_STATUSES)),
  priority: maybe(z.enum(ISSUE_PRIORITIES)),
  person: maybe(z.string().max(80)),
  title: maybe(z.string().max(200)),
  board: maybe(z.string().max(80)),
  when: maybe(z.string().max(80)),
  template: maybe(z.string().max(60)),
  into: maybe(z.enum(['cycle', 'release'])),
  days: maybe(z.number()),
});
type Proposed = z.infer<typeof proposeSchema>;

/** A proposed change as the parts of an intent, each part left out as null. */
export function partsOfProposal(proposed: Proposed): SaphaParts {
  return saphaPartsSchema.parse({
    issueKey: null,
    status: null,
    priority: null,
    person: null,
    title: null,
    board: null,
    when: null,
    query: null,
    place: null,
    ...Object.fromEntries(Object.entries(proposed).filter(([, value]) => value !== undefined)),
  });
}

/** What each tool takes, checked before it runs: the model's words are never trusted as they come. */
export const SAPHA_TOOLS = {
  search_issues: {
    description:
      'Find issues in this workspace by words in their title or description, optionally on one board (by its name or key) and in one status. Returns up to 10, newest first.',
    input: z.object({
      query: z.string().trim().max(200).nullable().optional(),
      board,
      status: z.enum(ISSUE_STATUSES).nullable().optional(),
    }),
  },
  get_issue: {
    description:
      'One issue by its key, like REL-12: its status, priority, assignee, due day, cycle, release, description, what it waits on, and its latest comments.',
    input: z.object({ key: z.string().trim().max(24) }),
  },
  running_cycles: {
    description:
      'The cycles running today on each board, or on one board: done of planned, days left, work added mid-cycle and work carried on from earlier cycles.',
    input: z.object({ board }),
  },
  releases: {
    description:
      'The releases in this workspace, not yet shipped first: each one’s day, and done of planned.',
    input: z.object({}),
  },
  my_work: {
    description:
      'What the person asking has on: their open issues, the overdue and soonest due first.',
    input: z.object({}),
  },
  people: {
    description: 'The people in this workspace, optionally only those whose name holds some words.',
    input: z.object({ name: z.string().trim().max(80).nullable().optional() }),
  },
  propose: {
    description:
      'Propose one change for the person to approve: never made by you. Give its kind and only the parts it needs: an issue key, a status or priority, a person’s name, a title, a board, when in words such as “friday”, a template’s name, into (cycle or release) or days. Call it once for each change, at most five.',
    input: proposeSchema,
  },
} as const;

export type SaphaToolName = keyof typeof SAPHA_TOOLS;
export const SAPHA_TOOL_NAMES = Object.keys(SAPHA_TOOLS) as SaphaToolName[];

/** An issue an answer may link to, because Sapha looked at it. */
export const saphaCitedSchema = z.object({ id: z.string(), key: z.string(), title: z.string() });
export type SaphaCited = z.infer<typeof saphaCitedSchema>;

/** One turn as the page shows it. */
export const saphaTurnSchema = z.object({
  id: z.string(),
  role: z.enum(['person', 'sapha']),
  text: z.string(),
  status: z.enum(['pending', 'done', 'failed']),
  steps: z.array(z.string()),
  proposals: z.array(saphaPartsSchema),
  issues: z.array(saphaCitedSchema),
  createdAt: z.string(),
});
export type SaphaTurn = z.infer<typeof saphaTurnSchema>;
