import { z } from 'zod';
import { auditEventsQuerySchema, uuid } from '../schemas.ts';
import { workspaceParams } from './common.ts';
import { contract } from './contract.ts';

/**
 * One audit event, in the shape the export API and the SIEM stream share.
 * The payload is whatever the event recorded, as written at the time, by
 * code that may be older than this: any JSON value, or the raw text of one
 * that could not be read.
 */
const auditEvent = z.object({
  /** The same event always carries the same key, so a receiver can de-duplicate. */
  key: uuid,
  workspaceId: uuid,
  seq: z.number().int(),
  occurredAt: z.string(),
  actor: z.object({ id: uuid.nullable(), kind: z.enum(['human', 'agent', 'system']) }),
  actorName: z.string().nullable(),
  requestId: z.string().nullable(),
  entity: z.object({ type: z.string(), id: z.string() }),
  type: z.string(),
  payload: z.unknown(),
  prevHash: z.string().nullable(),
  hash: z.string(),
  /** Which key signed it: null for an event from before signing. */
  keyId: z.string().nullable(),
  /** Personal fields kept outside the hash; null once erased. */
  personal: z.record(z.string(), z.unknown()).nullable(),
  personalCommitment: z.string().nullable(),
});

export const auditContracts = {
  'audit.events': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/audit/events',
    summary:
      "A page of a workspace's audit trail: newest first, or from a sequence number onwards for an export.",
    params: workspaceParams,
    query: auditEventsQuerySchema,
    response: z.object({ events: z.array(auditEvent), nextCursor: z.number().int().nullable() }),
  }),
  'audit.actors': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/audit/actors',
    summary: 'Everyone who appears in the trail, members first, former members after.',
    params: workspaceParams,
    response: z.object({
      actors: z.array(
        z.object({
          id: uuid,
          username: z.string().nullable(),
          name: z.string().nullable(),
          /** No longer a member: still listed, because their events still are. */
          former: z.boolean(),
        }),
      ),
    }),
  }),
  'audit.verify': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/audit/verify',
    summary:
      'Check the chain, from the last signed checkpoint, or from the start with full=1; names the first bad link.',
    params: workspaceParams,
    query: z.object({ full: z.string().optional() }),
    response: z.object({
      ok: z.boolean(),
      checked: z.number().int(),
      fromSeq: z.number().int(),
      head: z.object({ seq: z.number().int(), hash: z.string() }).nullable(),
      broken: z
        .object({
          seq: z.number().int(),
          eventId: z.string().nullable(),
          reason: z.enum([
            'missing',
            'altered',
            'relinked',
            'truncated',
            'downgraded',
            'unverifiable',
            'unsigned',
          ]),
          detail: z.string(),
        })
        .nullable(),
      checkpoint: z.enum(['none', 'used', 'rejected', 'stale']),
    }),
  }),
  'search.workspace': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/search',
    summary: 'Issues, documents and comments matching a query, best first.',
    params: workspaceParams,
    query: z.object({ q: z.string().optional() }),
    response: z.object({
      query: z.string(),
      results: z.array(
        z.object({
          kind: z.enum(['issue', 'document', 'comment']),
          id: uuid,
          title: z.string(),
          /** Matched terms wrapped in `<mark>`; rendered as text, never as HTML. */
          snippet: z.string(),
          rank: z.number(),
          issueId: uuid.nullable(),
          projectId: uuid.nullable(),
        }),
      ),
    }),
  }),
} as const;
