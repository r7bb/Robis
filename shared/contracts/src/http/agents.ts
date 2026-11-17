import { z } from 'zod';
import { AGENT_ROLES } from '../rbac.ts';
import { uuid } from '../schemas.ts';
import { avatar, workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Agents as teammates (B5): admins add them to a workspace with a role and
 * give them tokens, shown once. Ids in paths stay plain strings: one that
 * is not an agent here, however malformed, is the same 404 as one that is
 * gone.
 */

const agentParams = workspaceParams.extend({ agentId: z.string() });
const tokenParams = agentParams.extend({ tokenId: z.string() });

const label = z.string().trim().min(1, 'Name the token').max(80);

/** A token as its workspace's admins see it: never the secret again. */
const token = z.object({
  id: uuid,
  label: z.string(),
  createdAt: timestamp,
  expiresAt: timestamp.nullable(),
  revokedAt: timestamp.nullable(),
  lastUsedAt: timestamp.nullable(),
});

const agent = z.object({
  id: uuid,
  name: z.string(),
  username: z.string(),
  role: z.enum(AGENT_ROLES),
  avatar,
  createdAt: timestamp,
  tokens: z.array(token),
});

/** A new token: the one time its secret is shown. */
const issuedToken = z.object({ id: uuid, label: z.string(), secret: z.string() });

const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'Name the agent').max(60),
  role: z.enum(AGENT_ROLES),
  tokenLabel: label.default('First token'),
});

export const agentContracts = {
  'agents.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/agents',
    summary: "A workspace's agents and their tokens, for its admins.",
    params: workspaceParams,
    response: z.object({ agents: z.array(agent) }),
  }),
  'agents.create': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/agents',
    summary: 'Add an agent as a member or guest, with a first token shown once.',
    params: workspaceParams,
    body: createAgentSchema,
    status: 201,
    response: z.object({ agent: agent.omit({ tokens: true }), token: issuedToken }),
  }),
  'agents.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/agents/:agentId',
    summary: 'Remove an agent: its tokens stop working and it leaves the workspace.',
    params: agentParams,
    status: 204,
    response: null,
  }),
  'agents.issueToken': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/agents/:agentId/tokens',
    summary: 'Give an agent another token, shown once.',
    params: agentParams,
    body: z.object({ label }),
    status: 201,
    response: z.object({ token: issuedToken }),
  }),
  'agents.revokeToken': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/agents/:agentId/tokens/:tokenId',
    summary: "Revoke one of an agent's tokens; the next call carrying it is refused.",
    params: tokenParams,
    status: 204,
    response: null,
  }),
};
