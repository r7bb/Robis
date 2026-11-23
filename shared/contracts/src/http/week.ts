import { z } from 'zod';
import { ISSUE_STATUSES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * The week view (B8): the workspace's meetings as occurrences in a window,
 * and its issues due in that window, for anyone who may read both. The
 * browser sends the window, as only it knows where the viewer's week
 * begins, and lays everything out in the viewer's own zone.
 */

/** At most this long a window: a week, and a day either side for zones. */
export const WEEK_WINDOW_MAX_HOURS = 9 * 24;

const occurrence = z.object({
  meetingId: uuid,
  title: z.string(),
  startsAt: timestamp,
  durationMinutes: z.number().int(),
  /** Which week of a repeat, from 0. */
  week: z.number().int().nonnegative(),
  repeatCount: z.number().int().nullable(),
  /** Your answer, or null when you were not invited. */
  myResponse: z.enum(['pending', 'yes', 'no', 'maybe']).nullable(),
});

const dueIssue = z.object({
  id: uuid,
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  projectId: uuid,
  /** A calendar date, YYYY-MM-DD: due on that day wherever you are. */
  dueOn: z.string(),
});

export const weekContracts = {
  'calendar.week': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/calendar',
    summary:
      "The workspace's meeting occurrences in a window of at most nine days, and the issues due on the dates it covers.",
    params: workspaceParams,
    query: z.object({
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
      /** The first and last calendar dates the viewer sees, for due issues. */
      firstDay: z.iso.date(),
      lastDay: z.iso.date(),
    }),
    response: z.object({
      meetings: z.array(occurrence),
      issues: z.array(dueIssue),
    }),
  }),
};
