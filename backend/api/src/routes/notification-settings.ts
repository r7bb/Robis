import { type Database, type Executor, setSetting, settingsOf } from '@robis/database';
import { contracts } from '@robis/shared';
import type { FastifyInstance } from 'fastify';
import { serve } from '../contract.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';

/**
 * Your notification settings (C3): by kind and channel, for you alone. They
 * live with the account, not a workspace, as the inbox does.
 */
/** The settings as the API names the channels. */
async function shown(db: Executor, userId: string) {
  const settings = await settingsOf(db, userId);
  return {
    settings: settings.map(({ kind, channels }) => ({
      kind,
      channels: { inApp: channels.in_app, email: channels.email, push: channels.push },
    })),
  };
}

export async function notificationSettingRoutes(app: FastifyInstance, opts: { db: Database }) {
  const { db } = opts;

  serve(
    app,
    contracts['notificationSettings.get'],
    { preHandler: [requireAuth] },
    async (request) => shown(db, currentUser(request).id),
  );

  serve(
    app,
    contracts['notificationSettings.set'],
    { preHandler: [requireAuth] },
    async (request, { body: { kind, channel, enabled } }) => {
      const user = currentUser(request);
      await setSetting(db, user.id, kind, channel, enabled);
      return shown(db, user.id);
    },
  );
}
