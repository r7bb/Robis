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
  /** Whether it triages new issues here: comments suggestions, changes nothing. */
  triage: z.boolean(),
  /** Whether its triage comments may carry a language model's one-line summary. */
  summaries: z.boolean(),
  tokens: z.array(token),
});

/** A new token: the one time its secret is shown. */
const issuedToken = z.object({ id: uuid, label: z.string(), secret: z.string() });

const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'Name the agent').max(60),
  role: z.enum(AGENT_ROLES),
  tokenLabel: label.default('First token'),
  /** Make it the workspace's triage agent, in place of any other. */
  triage: z.boolean().default(false),
  /**
   * With `triage`: let its comments carry a one-line summary from a
   * language model, which sends each issue's text to a third party. Has
   * effect only where the server is configured with a provider key.
   */
  summaries: z.boolean().default(false),
});

const step = z.object({
  id: z.number().int(),
  tool: z.string().max(80),
  outcome: z.enum(['ok', 'denied', 'error']),
  status: z.number().int(),
  durationMs: z.number().int(),
  at: timestamp,
});

/** How many steps of one run are shown; a run's total is given beside them. */
export const RUN_STEPS_SHOWN = 50;
/** How many of the latest runs the activity view shows. */
export const RUNS_SHOWN = 20;

/** What an agent's change has come to, and so whether Undo is offered. */
export const AGENT_CHANGE_STATES = ['undoable', 'undone', 'changed', 'gone', 'manual'] as const;
/** The latest agent changes the agents page lists. */
export const AGENT_CHANGES_SHOWN = 50;

const changeParams = workspaceParams.extend({ changeId: z.string() });

export const agentContracts = {
  'agents.changes': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/agents/changes',
    summary:
      "The agents' latest changes, newest first: what each set from what to what, and whether it can be undone.",
    params: workspaceParams,
    response: z.object({
      changes: z.array(
        z.object({
          id: uuid,
          agentId: uuid,
          agentName: z.string(),
          entityType: z.enum(['issue', 'comment']),
          entityId: uuid,
          /** The issue it is on (a comment's issue), while it exists. */
          issueId: uuid.nullable(),
          issueKey: z.string().nullable(),
          field: z.string(),
          before: z.unknown(),
          after: z.unknown(),
          at: timestamp,
          /**
           * undoable: as the agent left it; undone: put back (by Undo or by
           * hand); changed: someone has changed it since; gone: deleted;
           * manual: a new issue, which is removed from its page instead.
           */
          state: z.enum(AGENT_CHANGE_STATES),
        }),
      ),
    }),
  }),
  'agents.undoChange': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/agents/changes/:changeId/undo',
    summary:
      "Undo an agent's change: put a field back, or remove a comment it wrote; refused once someone has changed it since.",
    params: changeParams,
    response: z.object({ ok: z.literal(true) }),
  }),
  'agents.activity': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/agents/activity',
    summary:
      "What the workspace's agents did: their latest runs step by step, and what people did with their changes.",
    params: workspaceParams,
    response: z.object({
      agents: z.array(
        z.object({
          id: uuid,
          name: z.string(),
          /** Judged after seven days; counts, never a rate without them. */
          kept: z.number().int(),
          edited: z.number().int(),
          reverted: z.number().int(),
          /** Younger than seven days, not judged yet. */
          pending: z.number().int(),
        }),
      ),
      runs: z.array(
        z.object({
          id: uuid,
          agentId: uuid,
          source: z.string(),
          startedAt: timestamp,
          lastStepAt: timestamp,
          stepCount: z.number().int(),
          steps: z.array(step),
        }),
      ),
    }),
  }),
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
