import { z } from 'zod';
import { STORY_TEXT_MAX_LENGTH, STORY_TONES } from '../limits.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Stories (B2): a photo or a few words, seen by the workspace for 24 hours.
 * Inside the workspace only, like everything else: a non-member gets 404.
 * Past its 24 hours a story is gone from every route at once, and with
 * stories turned off they are refused (409 `stories_off`).
 */

const story = z.object({
  id: uuid,
  authorId: uuid,
  kind: z.enum(['photo', 'text']),
  /** A text story's words; null for a photo. */
  body: z.string().nullable(),
  tone: z.enum(STORY_TONES).nullable(),
  /** A photo story's members-only image route; null for text. */
  url: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** A Different shot's place in Robis to try, and its button's words (Phase 2c). */
  tryPath: z.string().nullable().default(null),
  tryLabel: z.string().nullable().default(null),
  createdAt: timestamp,
  expiresAt: timestamp,
});

/**
 * A place inside Robis, as a path: letters, digits and a few separators,
 * no scheme, no host, no `//`. The server also checks it is this
 * workspace's or the account page.
 */
const tryPathSchema = z
  .string()
  .max(200)
  .regex(/^\/[a-z0-9/#?=_-]*$/, 'A path inside Robis')
  .refine((path) => !path.includes('//'), 'A path inside Robis');

export const storyContracts = {
  'stories.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/stories',
    summary: "The workspace's stories from the last 24 hours, oldest first.",
    params: workspaceParams,
    response: z.object({ stories: z.array(story) }),
  }),
  'stories.createPhoto': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/stories/photo',
    summary:
      'Post a photo story; it is re-encoded and stripped of metadata, within the workspace’s storage limit.',
    params: workspaceParams,
    rawBody: 'image/*',
    status: 201,
    response: z.object({ story }),
  }),
  'stories.createText': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/stories',
    summary: 'Post a few words as a story.',
    params: workspaceParams,
    body: z
      .object({
        body: z.string().trim().min(1).max(STORY_TEXT_MAX_LENGTH),
        tone: z.enum(STORY_TONES),
        /** A Different shot: where its Try it goes, and what the button says. */
        tryPath: tryPathSchema.optional(),
        tryLabel: z.string().trim().min(1).max(24).optional(),
      })
      .refine((story) => (story.tryPath === undefined) === (story.tryLabel === undefined), {
        message: 'A Try it needs both a place and its words',
      }),
    status: 201,
    response: z.object({ story }),
  }),
  'stories.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/stories/:storyId',
    summary: 'Take down a story you posted, or as an admin, any.',
    params: workspaceParams.extend({ storyId: z.string() }),
    status: 204,
    response: null,
  }),
  'workspaces.setStoriesEnabled': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/stories-enabled',
    summary: 'Turn stories on or off for the workspace; owners only. Off hides the ones there are.',
    params: workspaceParams,
    body: z.object({ enabled: z.boolean() }),
    response: z.object({ storiesEnabled: z.boolean() }),
  }),
} as const;
