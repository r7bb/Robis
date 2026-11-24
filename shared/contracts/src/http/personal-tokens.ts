import { z } from 'zod';
import { uuid } from '../schemas.ts';
import { contract, timestamp } from './contract.ts';

/**
 * Personal access tokens (C7): keys for the REST API, made and revoked by
 * their owner while signed in (a token cannot manage tokens). A token acts
 * as its owner on workspace routes only; without the write scope it may
 * only read. The secret is in the answer that makes it, and never again.
 */

export const TOKEN_SCOPES = ['read', 'write'] as const;
/** How long a new token may last, in days; null for until revoked. */
export const TOKEN_LIFETIMES = [30, 90, 365] as const;
/** Live tokens one person may hold. */
export const TOKENS_MAX = 20;

const token = z.object({
  id: uuid,
  name: z.string(),
  scopes: z.array(z.enum(TOKEN_SCOPES)),
  createdAt: timestamp,
  lastUsedAt: timestamp.nullable(),
  expiresAt: timestamp.nullable(),
});

export const personalTokenContracts = {
  'tokens.list': contract({
    method: 'GET',
    path: '/me/tokens',
    summary: 'Your live personal access tokens, never their secrets, with when each was last used.',
    response: z.object({ tokens: z.array(token) }),
  }),
  'tokens.create': contract({
    method: 'POST',
    path: '/me/tokens',
    summary:
      'Make a personal access token, with your password: read only, or read and write. Its secret is in this answer and never again.',
    body: z.object({
      name: z.string().trim().min(1).max(60),
      write: z.boolean(),
      /** Asked again, so a session left open cannot quietly make a lasting key. */
      password: z.string().min(1, 'Enter your password to confirm').max(1024),
      /** Days it lasts, or null for until revoked. */
      lifetimeDays: z.union([z.literal(30), z.literal(90), z.literal(365)]).nullable(),
    }),
    status: 201,
    response: z.object({ token, secret: z.string() }),
  }),
  'tokens.revoke': contract({
    method: 'DELETE',
    path: '/me/tokens/:tokenId',
    summary: 'Revoke one of your tokens; the next request that carries it is refused.',
    params: z.object({ tokenId: uuid }),
    status: 204,
    response: null,
  }),
};
