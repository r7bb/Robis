import { z } from 'zod';
import { PUSH_ENDPOINT_MAX } from '../push.ts';
import { contract } from './contract.ts';

/**
 * Web push (C3): the key a browser subscribes with, and the devices that
 * take pushes for you. Only the endpoint is sent: a push carries nothing,
 * so the encryption keys a subscription also offers are not wanted.
 */
const device = z.object({ endpoint: z.string().url().max(PUSH_ENDPOINT_MAX) });

export const pushContracts = {
  'push.key': contract({
    method: 'GET',
    path: '/push/key',
    summary: "The server's public push key, or null when web push is not set up.",
    response: z.object({ publicKey: z.string().nullable() }),
  }),
  'pushSubscriptions.add': contract({
    method: 'POST',
    path: '/me/push-subscriptions',
    summary: 'Take pushes on this device; a device someone else had moves to you.',
    body: device,
    status: 204,
    response: null,
  }),
  'pushSubscriptions.remove': contract({
    method: 'DELETE',
    path: '/me/push-subscriptions',
    summary: 'Stop pushes to this device.',
    body: device,
    status: 204,
    response: null,
  }),
} as const;
