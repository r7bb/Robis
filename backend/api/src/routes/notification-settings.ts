import {
  type Database,
  type Executor,
  previewUnsubscribe,
  redeemUnsubscribe,
  setSetting,
  settingsOf,
} from '@robis/database';
import { contracts } from '@robis/shared';
import type { FastifyInstance } from 'fastify';
import type { RateLimits } from '../app.ts';
import { serve } from '../contract.ts';
import { ApiError } from '../errors.ts';
import { currentUser, requireAuth } from '../plugins/authz.ts';
import { rateLimit } from '../plugins/rate-limit.ts';

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

export async function notificationSettingRoutes(
  app: FastifyInstance,
  opts: { db: Database; limits: RateLimits },
) {
  const { db, limits } = opts;
  // No session on these, only the token, so they are held to the sign-in budget.
  const limited = (name: string) =>
    rateLimit({ name, limit: limits.authPerMinute, windowMs: 60_000 });
  const gone = () => ApiError.notFound('That link has been used or has expired');

  serve(
    app,
    contracts['unsubscribe.preview'],
    { preHandler: [limited('unsubscribe-preview')] },
    async (_request, { body }) => {
      const kinds = await previewUnsubscribe(db, body.token);
      if (!kinds) throw gone();
      return { kinds };
    },
  );

  serve(
    app,
    contracts['unsubscribe.confirm'],
    { preHandler: [limited('unsubscribe')] },
    async (_request, { body }) => {
      const kinds = await redeemUnsubscribe(db, body.token);
      if (!kinds) throw gone();
      return { kinds };
    },
  );

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
