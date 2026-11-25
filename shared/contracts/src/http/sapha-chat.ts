import { z } from 'zod';
import { SAPHA_TURN_CHARS, saphaTurnSchema } from '../sapha-agent.ts';
import { uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Sapha, the agent: conversations with assistance turned on (D3). Each is
 * one person's, read by no one else; Sapha's answer to each turn is worked
 * out by the worker, which alone talks to the provider, and the page reads
 * it when ready. Changes it proposes are made only when the person says yes,
 * through the routes their buttons use.
 */

const said = z.object({ text: z.string().trim().min(1).max(SAPHA_TURN_CHARS) });
const conversationParams = workspaceParams.extend({ conversationId: z.string() });
const conversationSummary = z.object({ id: uuid, title: z.string(), updatedAt: timestamp });

export const saphaChatContracts = {
  'sapha.start': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/sapha/conversations',
    summary:
      'Start a conversation with Sapha: what is asked, and the turn Sapha will answer, worked out by the worker.',
    params: workspaceParams,
    body: said,
    status: 201,
    response: z.object({ conversation: z.object({ id: uuid }), reply: z.object({ id: uuid }) }),
  }),
  'sapha.say': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/sapha/conversations/:conversationId/messages',
    summary: 'Say more in a conversation; Sapha answers with what was said before in mind.',
    params: conversationParams,
    body: said,
    status: 201,
    response: z.object({ reply: z.object({ id: uuid }) }),
  }),
  'sapha.conversation': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/sapha/conversations/:conversationId',
    summary:
      'A conversation, oldest turn first: what was asked, and each answer with the steps Sapha took, the changes it proposes and the issues it looked at.',
    params: conversationParams,
    response: z.object({ conversation: conversationSummary, turns: z.array(saphaTurnSchema) }),
  }),
  'sapha.conversations': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/sapha/conversations',
    summary: 'The asker’s conversations with Sapha here, most recent first.',
    params: workspaceParams,
    response: z.object({ conversations: z.array(conversationSummary) }),
  }),
  'sapha.forget': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/sapha/conversations/:conversationId',
    summary: 'Clear one conversation, for good.',
    params: conversationParams,
    status: 204,
    response: null,
  }),
  'sapha.forgetAll': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/sapha/conversations',
    summary: 'Clear every conversation the asker has had with Sapha here, for good.',
    params: workspaceParams,
    status: 204,
    response: null,
  }),
} as const;
