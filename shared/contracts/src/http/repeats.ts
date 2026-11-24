import { z } from 'zod';
import { isTimeZone } from '../calendar.ts';
import { ISSUE_PRIORITIES } from '../domain.ts';
import { REPEAT_CADENCES, REPEAT_MONTH_DAY_MAX } from '../repeats.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Repeats: issues filed on a board on a schedule, such as a weekly release
 * check. Whoever may file issues sets one up; whoever set it up, or an
 * admin, pauses, changes or removes it.
 */

const projectParams = workspaceParams.extend({ projectId: z.string() });
const repeatParams = workspaceParams.extend({ repeatId: z.string() });

const schedule = {
  cadence: z.enum(REPEAT_CADENCES),
  weekday: z.number().int().min(0).max(6).nullable(),
  monthDay: z.number().int().min(1).max(REPEAT_MONTH_DAY_MAX).nullable(),
  hour: z.number().int().min(0).max(23),
  timeZone: z.string().refine(isTimeZone, 'Not a time zone'),
};

const settings = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullable(),
  priority: z.enum(ISSUE_PRIORITIES),
  assigneeId: uuid.nullable(),
};

/** A weekly repeat names its day; a monthly one its date; the rest neither. */
const scheduleHolds = (value: {
  cadence?: string;
  weekday?: number | null;
  monthDay?: number | null;
}) =>
  value.cadence === undefined ||
  ((value.cadence === 'weekly' ? value.weekday != null : true) &&
    (value.cadence === 'monthly' ? value.monthDay != null : true));

const repeat = z.object({
  id: uuid,
  projectId: uuid,
  ...settings,
  ...schedule,
  nextRunAt: timestamp,
  lastRunAt: timestamp.nullable(),
  paused: z.boolean(),
  createdBy: uuid,
  createdByName: z.string(),
});

export const repeatContracts = {
  'repeats.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId/repeats',
    summary: 'A board’s repeating issues, soonest first, with when each is next filed.',
    params: projectParams,
    response: z.object({ repeats: z.array(repeat) }),
  }),
  'repeats.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/repeats',
    summary:
      'File an issue on this board on a schedule: daily, on weekdays, weekly on a day or monthly on a date, at an hour on your clock.',
    params: projectParams,
    body: z
      .object({ ...settings, ...schedule })
      .refine(scheduleHolds, 'A weekly repeat needs its day, a monthly one its date'),
    status: 201,
    response: z.object({ repeat }),
  }),
  'repeats.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/repeats/:repeatId',
    summary: 'Pause, resume or change a repeat; its next run is worked out again.',
    params: repeatParams,
    body: z
      .object({ ...settings, ...schedule, paused: z.boolean() })
      .partial()
      .refine((v) => Object.keys(v).length > 0, 'No fields to update')
      .refine(scheduleHolds, 'A weekly repeat needs its day, a monthly one its date'),
    response: z.object({ repeat }),
  }),
  'repeats.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/repeats/:repeatId',
    summary: 'Stop a repeat for good; the issues it filed stay.',
    params: repeatParams,
    status: 204,
    response: null,
  }),
} as const;
