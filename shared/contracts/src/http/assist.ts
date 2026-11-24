import { z } from 'zod';
import { ISSUE_PRIORITIES } from '../domain.ts';
import { saphaPartsSchema } from '../sapha.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * Assistance (D3): advisory help from the optional language-model provider.
 * Off by default; it needs both the server's key and an admin turning it on
 * here, and until both every call but the status answers 404, exactly as
 * before it existed. An ask returns a request id at once; the worker, which
 * alone talks to the provider, answers it, and the page reads the answer. What comes back is generated, says so on the page, and
 * is posted nowhere until a person presses a button.
 */

const requested = z.object({ request: z.object({ id: uuid }) });

const point = z.object({
  text: z.string(),
  /** The comments or messages it came from, by id: each a link on the page. */
  sources: z.array(uuid),
});

export const assistContracts = {
  'assist.status': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/assist',
    summary:
      'Whether assistance is on here: turned on by an admin, and given a key by whoever runs the server.',
    params: workspaceParams,
    response: z.object({ enabled: z.boolean(), keyed: z.boolean() }),
  }),
  'assist.configure': contract({
    method: 'PUT',
    path: '/workspaces/:workspaceId/assist',
    summary: 'Turn assistance on or off for this workspace (admins).',
    params: workspaceParams,
    body: z.object({ enabled: z.boolean() }),
    response: z.object({ enabled: z.boolean() }),
  }),
  'assist.summary': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/assist/summary',
    summary:
      'A summary of an issue’s comments or a channel’s recent messages, each point linked to what it came from.',
    params: workspaceParams,
    body: z.object({ kind: z.enum(['issue', 'channel']), id: uuid }),
    status: 201,
    response: requested,
  }),
  'assist.agenda': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/assist/agenda',
    summary:
      'A draft agenda for a meeting from the issues its title and agenda name by key, for its organiser to use or not.',
    params: workspaceParams,
    body: z.object({ meetingId: uuid }),
    status: 201,
    response: requested,
  }),
  'assist.issue': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/assist/issue',
    summary: 'A suggested title and priority for turning a chat message into an issue.',
    params: workspaceParams,
    body: z.object({ messageId: uuid }),
    status: 201,
    response: requested,
  }),
  'assist.interpret': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/assist/interpret',
    summary:
      'Sapha, tier 1: a request the browser could not read, read by the provider into the parts of one action, for the asker to check and confirm.',
    params: workspaceParams,
    body: z.object({ request: z.string().trim().min(1).max(300) }),
    status: 201,
    response: requested,
  }),
  'assist.result': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/assist/requests/:requestId',
    summary:
      'An ask’s answer once the worker has it: pending, done with the checked result, or failed. Only whoever asked can read it.',
    params: workspaceParams.extend({ requestId: z.string() }),
    response: z.object({
      status: z.enum(['pending', 'done', 'failed']),
      result: z
        .discriminatedUnion('kind', [
          z.object({ kind: z.literal('summary'), points: z.array(point) }),
          z.object({
            kind: z.literal('agenda'),
            items: z.array(z.object({ text: z.string(), issueIds: z.array(uuid) })),
            issues: z.array(z.object({ id: uuid, key: z.string(), title: z.string() })),
          }),
          z.object({
            kind: z.literal('issue'),
            title: z.string(),
            priority: z.enum(ISSUE_PRIORITIES),
          }),
          z.object({ kind: z.literal('intent'), parts: saphaPartsSchema }),
        ])
        .nullable(),
    }),
  }),
} as const;
