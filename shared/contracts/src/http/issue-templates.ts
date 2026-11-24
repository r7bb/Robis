import { z } from 'zod';
import { ISSUE_PRIORITIES } from '../domain.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';
import { ISSUE_LABELS_MAX } from './labels.ts';

/**
 * Issue templates: a starting point for a kind of issue (a title to finish,
 * the description to fill in, a priority and labels), kept for the
 * workspace and filed onto any of its boards. Whoever may file issues makes
 * and uses them; whoever made one, or an admin, removes it.
 */

/** Templates a workspace keeps at most. */
export const ISSUE_TEMPLATES_MAX = 50;

const templateParams = workspaceParams.extend({ templateId: z.string() });

const template = z.object({
  id: uuid,
  name: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(ISSUE_PRIORITIES),
  labelIds: z.array(uuid),
  createdBy: uuid.nullable(),
  createdAt: timestamp,
});

export const issueTemplateContracts = {
  'issueTemplates.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issue-templates',
    summary: 'The workspace’s issue templates, by name.',
    params: workspaceParams,
    response: z.object({ templates: z.array(template) }),
  }),
  'issueTemplates.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/issue-templates',
    summary:
      'Keep a template: a name, the title to start from, a description, a priority and labels.',
    params: workspaceParams,
    body: z.object({
      name: z.string().trim().min(1).max(60),
      title: z.string().trim().min(1).max(200),
      description: z.string().trim().max(20_000).nullable().optional(),
      priority: z.enum(ISSUE_PRIORITIES).default('NONE'),
      labelIds: z.array(uuid).max(ISSUE_LABELS_MAX).default([]),
    }),
    status: 201,
    response: z.object({ template }),
  }),
  'issueTemplates.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/issue-templates/:templateId',
    summary: 'Remove a template; issues filed from it stay as they are.',
    params: templateParams,
    status: 204,
    response: null,
  }),
  'issueTemplates.file': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/issue-templates/:templateId/issues',
    summary:
      'File an issue from a template onto a board: its title (or the one given), description, priority and labels.',
    params: templateParams,
    body: z.object({
      projectId: uuid,
      title: z.string().trim().min(1).max(200).optional(),
    }),
    status: 201,
    response: z.object({ issue: z.object({ id: uuid, key: z.string() }) }),
  }),
} as const;
