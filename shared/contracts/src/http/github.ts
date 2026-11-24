import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

/**
 * GitHub pull requests on issues (C7). An admin connects the workspace and
 * adds the address and secret to a repository's webhooks; from then on a
 * pull request whose title or branch names an issue key (WEB-12) shows on
 * that issue with its state, and, if the admin chose it, merging it moves
 * the issue to done. GitHub signs each delivery; an unsigned one is refused.
 */

export const PULL_REQUEST_STATES = ['open', 'draft', 'merged', 'closed'] as const;

const workspaceParams = z.object({ workspaceId: uuid });

const link = z.object({
  moveToDone: z.boolean(),
  createdAt: timestamp,
  /** Where GitHub sends its webhook, relative to the site. */
  webhookPath: z.string(),
});

const pullRequest = z.object({
  repo: z.string(),
  number: z.number().int(),
  title: z.string(),
  url: z.string().startsWith('https://'),
  state: z.enum(PULL_REQUEST_STATES),
  updatedAt: timestamp,
});

export const githubContracts = {
  'github.link': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/github',
    summary: 'Whether this workspace is connected to GitHub, and how. Admins only.',
    params: workspaceParams,
    response: z.object({ link: link.nullable() }),
  }),
  'github.connect': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/github',
    summary:
      'Connect to GitHub, or make a new secret: the secret for the repository webhook is in this answer and never again. Admins only.',
    params: workspaceParams,
    body: z.object({ moveToDone: z.boolean() }),
    status: 201,
    response: z.object({ link, secret: z.string() }),
  }),
  'github.update': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/github',
    summary: 'Choose whether merging a linked pull request moves the issue to done. Admins only.',
    params: workspaceParams,
    body: z.object({ moveToDone: z.boolean() }),
    response: z.object({ link }),
  }),
  'github.disconnect': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/github',
    summary: 'Disconnect from GitHub; its webhook is refused from then on. Admins only.',
    params: workspaceParams,
    status: 204,
    response: null,
  }),
  'issues.pullRequests': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/issues/:issueId/pull-requests',
    summary: "The pull requests that name this issue's key, with each one's state.",
    params: workspaceParams.extend({ issueId: uuid }),
    response: z.object({ pullRequests: z.array(pullRequest) }),
  }),
};
