import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Remind me: a note to yourself about an issue, a chat message or a space
 * thread, which waits under Later in your inbox and comes back unread (and
 * pushed, where a device takes pushes) at the time you chose. Nobody else
 * sees it; dismiss it or bring it back early as any other entry.
 */

export const REMINDER_SUBJECTS = ['issue', 'message', 'thread'] as const;

export const reminderContracts = {
  'reminders.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/reminders',
    summary:
      'Be reminded of an issue, a chat message or a space thread at a time up to 90 days ahead, in your own inbox.',
    params: workspaceParams,
    body: z.object({
      about: z.enum(REMINDER_SUBJECTS),
      id: uuid,
      at: z.coerce.date(),
    }),
    status: 201,
    response: z.object({ reminder: z.object({ id: uuid, at: timestamp }) }),
  }),
} as const;
