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
  createdAt: timestamp,
  expiresAt: timestamp,
});

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
    body: z.object({
      body: z.string().trim().min(1).max(STORY_TEXT_MAX_LENGTH),
      tone: z.enum(STORY_TONES),
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
