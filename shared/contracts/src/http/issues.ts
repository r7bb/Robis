import { z } from 'zod';
import { ISSUE_PRIORITIES, ISSUE_STATUSES } from '../domain.ts';
import {
  createCommentSchema,
  createIssueSchema,
  listIssuesQuerySchema,
  similarIssuesQuerySchema,
  updateIssueSchema,
  uuid,
} from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** Ids stay plain strings: one that is not an issue is a 404, not a 400. */
const issueParams = workspaceParams.extend({ issueId: z.string() });
const projectParams = workspaceParams.extend({ projectId: z.string() });

const status = z.enum(ISSUE_STATUSES);
const priority = z.enum(ISSUE_PRIORITIES);

/** An issue as the API shows it; `key` is its project's key and number, `WEB-4`. */
const issue = z.object({
  id: uuid,
  workspaceId: uuid,
  projectId: uuid,
  number: z.number().int(),
  key: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status,
  priority,
  assigneeId: uuid.nullable(),
  createdBy: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Who each `@handle` in a comment meant when it was written, by today's username. */
const mention = z.object({ handle: z.string(), userId: uuid, username: z.string() });

const comment = z.object({
  id: uuid,
  body: z.string(),
  createdAt: timestamp,
  authorId: uuid,
  authorName: z.string(),
  mentions: z.array(mention),
});

export const issueContracts = {
  'issues.similar': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/similar',
    summary: 'Issues that may be duplicates of a draft; empty when the service has nothing.',
    params: workspaceParams,
    query: similarIssuesQuerySchema,
    // The ML service's answer, already checked by the API's client; kept
    // loose here so nothing it sends can turn a hint into an error.
    response: z.object({
      similar: z.array(z.object({ id: z.string(), title: z.string(), score: z.number() })),
    }),
  }),
  'issues.triage': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/triage',
    summary:
      'A suggested priority for a draft, a refusal with the counts it needs, or null for nothing to say.',
    params: workspaceParams,
    query: similarIssuesQuerySchema,
    response: z.object({
      suggestion: z
        .union([
          z.object({ priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']), score: z.number() }),
          z.object({ priority: z.null(), trainedOn: z.number(), needed: z.number() }),
        ])
        .nullable(),
    }),
  }),
  'issues.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/projects/:projectId/issues',
    summary: "A page of a project's issues, newest first, with a cursor for the next.",
    params: projectParams,
    query: listIssuesQuerySchema,
    response: z.object({
      issues: z.array(
        issue
          .pick({
            id: true,
            projectId: true,
            number: true,
            key: true,
            title: true,
            status: true,
            priority: true,
            assigneeId: true,
            createdAt: true,
            updatedAt: true,
          })
          .extend({ assigneeName: z.string().nullable() }),
      ),
      nextCursor: z.string().nullable(),
    }),
  }),
  'issues.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/projects/:projectId/issues',
    summary: 'File an issue; it takes the next number in its project.',
    params: projectParams,
    body: createIssueSchema,
    status: 201,
    response: z.object({ issue }),
  }),
  'issues.get': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/:issueId',
    summary: 'One issue.',
    params: issueParams,
    response: z.object({ issue }),
  }),
  'issues.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/issues/:issueId',
    summary: 'Change an issue: its title, description, status, priority or assignee.',
    params: issueParams,
    body: updateIssueSchema,
    response: z.object({ issue }),
  }),
  'issues.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/issues/:issueId',
    summary: 'Delete an issue, its comments and its images.',
    params: issueParams,
    status: 204,
    response: null,
  }),
  'comments.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/:issueId/comments',
    summary: "An issue's comments, oldest first.",
    params: issueParams,
    response: z.object({ comments: z.array(comment) }),
  }),
  'comments.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/issues/:issueId/comments',
    summary: 'Comment on an issue; anyone it @mentions is told.',
    params: issueParams,
    body: createCommentSchema,
    status: 201,
    response: z.object({ comment }),
  }),
  'comments.delete': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/comments/:commentId',
    summary: "Delete your own comment, or as an admin, anyone's.",
    params: workspaceParams.extend({ commentId: z.string() }),
    status: 204,
    response: null,
  }),
} as const;
