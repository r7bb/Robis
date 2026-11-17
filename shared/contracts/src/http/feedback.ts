import { z } from 'zod';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * What people do with the composer's hints (B6): use them or set them
 * aside. Counted per workspace without naming anyone, and shown beside the
 * offline evaluation, which is a different measurement: a labelled set
 * judged by hand, not people at work.
 */

export const SUGGESTION_KINDS = ['duplicate', 'priority'] as const;
export const SUGGESTION_ACTIONS = ['accepted', 'dismissed'] as const;

/**
 * The duplicate finder's offline evaluation, as robis-ml/README.md reports
 * it (the labelled set's test half, at the 0.40 threshold). A test keeps the
 * two in step. Priority triage has no offline evaluation to compare with.
 */
export const OFFLINE_DUPLICATE_EVALUATION = {
  threshold: 0.4,
  precision: 0.79,
  correctHints: 15,
  hints: 19,
  recall: 0.62,
  foundPairs: 15,
  pairs: 24,
} as const;

const counts = z.object({ accepted: z.number().int(), dismissed: z.number().int() });

export const feedbackContracts = {
  'suggestions.feedback': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/suggestions/feedback',
    summary: 'Record that a hint was used or set aside; nobody is named.',
    params: workspaceParams,
    body: z.object({
      kind: z.enum(SUGGESTION_KINDS),
      action: z.enum(SUGGESTION_ACTIONS),
      /** The hint's own score, 0 to 1. */
      score: z.number().min(0).max(1).optional(),
    }),
    status: 204,
    response: null,
  }),
  'suggestions.stats': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/suggestions/stats',
    summary:
      "How often this workspace's people used each kind of hint, beside the offline evaluation.",
    params: workspaceParams,
    response: z.object({
      live: z.object({ duplicate: counts, priority: counts }),
      offline: z.object({
        duplicate: z.object({
          threshold: z.number(),
          precision: z.number(),
          correctHints: z.number().int(),
          hints: z.number().int(),
          recall: z.number(),
          foundPairs: z.number().int(),
          pairs: z.number().int(),
        }),
        priority: z.null(),
      }),
    }),
  }),
};
