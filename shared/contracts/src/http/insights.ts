import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Insights (Phase 6), from real events only: how long work takes and how
 * much gets done, read from the status changes the audit trail already
 * keeps. Worked out when asked, never stored, for anyone who may read the
 * workspace's issues.
 */

/** How far back the figures look: twelve weeks, counted back from now. */
export const INSIGHT_WEEKS = 12;

/**
 * Below this many finished issues a project gets its counts and no figures:
 * a median of four is a guess, and a chart would make it look like more.
 * The same rule the priority model follows before it suggests anything.
 */
export const INSIGHT_MIN_SAMPLE = 10;

/** Seconds from an issue's first move into work to its last move to done. */
const cycleTime = z.object({
  medianSeconds: z.number().nonnegative(),
  /** Half of the issues took between these two. */
  p25Seconds: z.number().nonnegative(),
  p75Seconds: z.number().nonnegative(),
  /** One in ten took longer than this. */
  p90Seconds: z.number().nonnegative(),
});

const projectFlow = z.object({
  id: uuid,
  key: z.string(),
  name: z.string(),
  /** Issues whose last move to done falls in the window and are still done. */
  finished: z.number().int().nonnegative(),
  /** Of those, the ones with a recorded start; the rest went straight to done. */
  measured: z.number().int().nonnegative(),
  /** Issues finished in each week, oldest first; null below the minimum sample. */
  throughput: z.array(z.number().int().nonnegative()).length(INSIGHT_WEEKS).nullable(),
  /** Null when fewer than the minimum sample have a recorded start. */
  cycleTime: cycleTime.nullable(),
});

export const insightContracts = {
  'insights.flow': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/insights/flow',
    summary:
      "Each active project's cycle time and weekly throughput over twelve weeks, from status changes.",
    params: workspaceParams,
    response: z.object({
      since: timestamp,
      weeks: z.literal(INSIGHT_WEEKS),
      minSample: z.literal(INSIGHT_MIN_SAMPLE),
      projects: z.array(projectFlow),
    }),
  }),
};
