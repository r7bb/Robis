import { z } from 'zod';
import { USER_KINDS } from '../domain.ts';
import { PROFILE_TITLE_MAX_LENGTH, WORKING_ON_MAX_LENGTH } from '../limits.ts';
import { ROLES } from '../rbac.ts';
import { uuid } from '../schemas.ts';
import { avatar, workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';
import { activityEvent } from './workspaces.ts';

/**
 * Profiles (B2), inside a workspace only: a person as this team knows them.
 * Anyone who is not a member of the workspace, or asks after someone who
 * is not, gets 404. Activity is only what the viewer's role may read.
 */

const personParams = workspaceParams.extend({ userId: z.string() });

/** Empty means none: a cleared field is stored as nothing, not as "". */
const optionalLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const profile = z.object({
  userId: uuid,
  name: z.string(),
  username: z.string(),
  kind: z.enum(USER_KINDS),
  role: z.enum(ROLES),
  avatar,
  title: z.string().nullable(),
  workingOn: z.string().nullable(),
  /** The members-only cover route, or null for the generated band. */
  cover: z.string().nullable(),
  joinedAt: timestamp,
});

/** An image they added to an issue, for the profile's grid. */
const sharedImage = z.object({
  id: uuid,
  issueId: uuid,
  url: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  createdAt: timestamp,
});

export const profileContracts = {
  'profiles.get': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/people/:userId',
    summary:
      "A member's profile here: title, what they are working on, recent activity the viewer may read, and the images they shared.",
    params: personParams,
    response: z.object({
      profile,
      activity: z.array(activityEvent),
      shared: z.array(sharedImage),
    }),
  }),
  'profiles.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/people/me',
    summary: 'Change your title or what you are working on, in this workspace.',
    params: workspaceParams,
    body: z
      .object({
        title: optionalLine(PROFILE_TITLE_MAX_LENGTH).optional(),
        workingOn: optionalLine(WORKING_ON_MAX_LENGTH).optional(),
      })
      .refine((body) => body.title !== undefined || body.workingOn !== undefined, {
        message: 'Change at least one field',
      }),
    response: z.object({ profile }),
  }),
  'profiles.setCover': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/people/me/cover',
    summary: 'Set the cover photo on your profile here; re-encoded and stripped of metadata.',
    params: workspaceParams,
    rawBody: 'image/*',
    response: z.object({ profile }),
  }),
  'profiles.removeCover': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/people/me/cover',
    summary: 'Remove the cover photo from your profile here.',
    params: workspaceParams,
    status: 204,
    response: null,
  }),
} as const;
