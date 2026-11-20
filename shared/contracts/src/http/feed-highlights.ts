import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * What the Feed shows beside the posts (Phase 2c): how each project is
 * doing, and this week's milestones worth a well done, both worked out
 * from the work when asked, never stored. Inside the workspace only, for
 * anyone who may read its issues.
 */

/**
 * A project's state, from rules anyone can check against the numbers
 * beside it (backend/api/src/feed/health.ts): `needs_a_look` when an open
 * issue is overdue or urgent, `quiet` when nothing has moved for two weeks,
 * `finished` when every issue is closed, otherwise `on_track`.
 */
export const PROJECT_HEALTH_STATES = ['needs_a_look', 'on_track', 'quiet', 'finished'] as const;
export type ProjectHealthState = (typeof PROJECT_HEALTH_STATES)[number];

const projectHealth = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  state: z.enum(PROJECT_HEALTH_STATES),
  open: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Done in the last seven days. */
  doneRecently: z.number().int().nonnegative(),
  /** Filed in the last seven days. */
  openedRecently: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  urgent: z.number().int().nonnegative(),
  /** When any of its issues last changed. */
  lastMovedAt: timestamp,
});

/**
 * What a celebration is for: a project with every issue done, someone's
 * 10th (25th, 50th...) issue done, a year (or more) with the team, or a
 * new teammate. Only for people who have not turned celebrations off, and
 * never for agents.
 */
export const CELEBRATION_KINDS = [
  'project_finished',
  'issues_done',
  'anniversary',
  'joined',
] as const;
export type CelebrationKind = (typeof CELEBRATION_KINDS)[number];

const celebration = z.object({
  /** The same for the same milestone on every read, so the page can put one away. */
  id: z.string(),
  kind: z.enum(CELEBRATION_KINDS),
  at: timestamp,
  /** Whose it is; null for a project's. */
  userId: uuid.nullable(),
  projectId: uuid.nullable(),
  projectName: z.string().nullable(),
  /** Issues done, or years with the team; null where there is no number. */
  count: z.number().int().positive().nullable(),
});

export const feedHighlightContracts = {
  'feed.projects': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/feed/projects',
    summary:
      'How each active project is doing, from its issues: open, done in the last seven days, overdue, urgent, and a state worked out from those (needs a look, on track, quiet or finished).',
    params: workspaceParams,
    /** Your calendar's today, so overdue means what the board says it means; within a day of the server's. */
    query: z.object({ today: z.iso.date().optional() }),
    response: z.object({ projects: z.array(projectHealth) }),
  }),
  'feed.celebrations': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/feed/celebrations',
    summary:
      'Milestones from the last seven days worth a well done: a project finished, an issue milestone, an anniversary, a new teammate. Never for anyone who turned celebrations off, nor for agents.',
    params: workspaceParams,
    response: z.object({ celebrations: z.array(celebration) }),
  }),
} as const;
