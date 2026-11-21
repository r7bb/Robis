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
  /** Of those, the ones with a recorded start; the rest never moved into work. */
  measured: z.number().int().nonnegative(),
  /** Issues finished in each week, oldest first; null below the minimum sample. */
  throughput: z.array(z.number().int().nonnegative()).length(INSIGHT_WEEKS).nullable(),
  /** Null when fewer than the minimum sample have a recorded start. */
  cycleTime: cycleTime.nullable(),
});

/**
 * System health (Phase 6) is read from two timings the services record as
 * they work, kept as counts per minute in fixed buckets so every instance's
 * readings add up: how long a change waited in a browser's offline queue
 * before the server accepted it, and how long an event took from its write
 * to reaching open tabs.
 */
export const INSTRUMENTS = ['sync_lag', 'fanout_latency'] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

/**
 * Each bucket's upper edge in milliseconds; one more bucket holds anything
 * beyond the last. From ten milliseconds (a live update) to a day (a laptop
 * that was shut overnight with changes queued).
 */
export const INSTRUMENT_BOUNDS_MS = [
  10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000,
  21_600_000, 86_400_000,
] as const;

/**
 * Sent by the web app's offline queue with each write it replays: how long,
 * in milliseconds on the browser's own clock, the change waited before this
 * send. The API counts it as sync lag when the write is accepted.
 */
export const QUEUED_FOR_HEADER = 'robis-queued-for';

/** How far back the timings look. */
export const HEALTH_HOURS = 24;

/** How far back hint acceptance looks: hints are fewer than timings. */
export const SUGGESTION_DAYS = 30;

/**
 * A quantile from bucket counts is only known to within a bucket, so it is
 * given as the bucket's upper edge: "within 250 ms". Null edge: beyond the
 * last bucket.
 */
const within = z.object({ withinMs: z.number().int().positive().nullable() });

const reading = z.object({
  /** Timings recorded in the window. */
  count: z.number().int().nonnegative(),
  /** Null below the minimum sample. */
  median: within.nullable(),
  p95: within.nullable(),
});

const acceptance = z.object({
  accepted: z.number().int().nonnegative(),
  dismissed: z.number().int().nonnegative(),
  /** Accepted out of both, 0 to 1; null below the minimum sample. */
  rate: z.number().min(0).max(1).nullable(),
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
  'insights.health': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/insights/health',
    summary:
      "This workspace's hint acceptance and, for the server's operators, its job queue and a day of sync lag and live-update latency.",
    params: workspaceParams,
    response: z.object({
      since: timestamp,
      hours: z.literal(HEALTH_HOURS),
      minSample: z.literal(INSIGHT_MIN_SAMPLE),
      /**
       * The whole server, every workspace on it, in counts only: for the
       * people who run it (HEALTH_OPERATORS), null for anyone else.
       */
      server: z
        .object({
          queue: z.object({
            due: z.number().int().nonnegative(),
            /** How long the oldest due job has waited; null when none is due. */
            oldestDueSeconds: z.number().nonnegative().nullable(),
            deadLetters: z.number().int().nonnegative(),
          }),
          syncLag: reading,
          fanOut: reading,
        })
        .nullable(),
      /** This workspace's people, nobody named, over thirty days. */
      suggestions: z.object({
        days: z.literal(SUGGESTION_DAYS),
        duplicate: acceptance,
        priority: acceptance,
      }),
    }),
  }),
};
