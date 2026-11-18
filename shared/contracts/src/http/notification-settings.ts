import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_KINDS } from '../domain.ts';
import { contract } from './contract.ts';

/**
 * Your notification settings (C3): every kind, on or off in each channel.
 * Everything starts on; only what you turn off is stored.
 */

const channels = z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() });

const settings = z.object({
  settings: z.array(z.object({ kind: z.enum(NOTIFICATION_KINDS), channels })),
});

export const notificationSettingContracts = {
  'notificationSettings.get': contract({
    method: 'GET',
    path: '/me/notification-settings',
    summary: 'Your notification settings: each kind, on or off in the app, by email and by push.',
    response: settings,
  }),
  'notificationSettings.set': contract({
    method: 'PUT',
    path: '/me/notification-settings',
    summary: 'Turn one kind on or off in one channel; returns every setting.',
    body: z.object({
      kind: z.enum(NOTIFICATION_KINDS),
      channel: z.enum(NOTIFICATION_CHANNELS),
      enabled: z.boolean(),
    }),
    response: settings,
  }),
} as const;
