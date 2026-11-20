import { createSession, DEVICE_TTL_MS, deviceCookieName, noteDevice } from '@robis/auth';
import { type Database, queueNewDeviceMail, recordAccountEventNow } from '@robis/database';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from './env.ts';
import { strike } from './plugins/rate-limit.ts';

/** How the session cookie is set and cleared, wherever a session starts or ends. */
export function sessionCookieOptions(env: Env) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    // Always in production, whatever COOKIE_SECURE says; it only relaxes
    // local development over plain http.
    secure: env.NODE_ENV === 'production' || env.COOKIE_SECURE,
    path: '/',
  };
}

/** A new session for `userId`, handed to this browser as its cookie. */
export async function startSession(
  db: Database,
  env: Env,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<void> {
  const userAgent = request.headers['user-agent'];
  const session = await createSession(db, userId, userAgent);
  reply.setCookie(request.server.sessionCookieName, session.token, {
    ...sessionCookieOptions(env),
    expires: session.expiresAt,
  });
  await noteThisBrowser(db, env, request, reply, userId, session.id);
}

/** Alert mails one account is sent in an hour at most, however often a stranger signs in. */
const ALERTS_PER_HOUR = 3;
const HOUR_MS = 60 * 60_000;

/**
 * Remember the browser a session started in, and tell the account's owner
 * if it is one they had not used (C4). The browser is remembered and its
 * alert queued together or not at all, so a browser never becomes known
 * without its alert. Best kept going: a sign-in still succeeds if this
 * fails, and the failure is logged.
 */
async function noteThisBrowser(
  db: Database,
  env: Env,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  sessionId: string,
) {
  const name = deviceCookieName(env.NODE_ENV);
  try {
    const device = await db.transaction(async (tx) => {
      const noted = await noteDevice(tx, userId, request.cookies[name]);
      // Past a few in an hour the browser is still remembered, unmailed:
      // the alerts already sent say enough, and the inbox is not flooded.
      if (
        noted.isNewDevice &&
        (await strike(request.server.rateStore, 'new-device-alerts', userId, HOUR_MS, tx)) <=
          ALERTS_PER_HOUR
      ) {
        await queueNewDeviceMail(tx, sessionId);
      }
      return noted;
    });
    reply.setCookie(name, device.token, {
      ...sessionCookieOptions(env),
      expires: new Date(Date.now() + DEVICE_TTL_MS),
    });
    if (device.isNewDevice) {
      await recordAccountEventNow(db, userId, 'auth.new_device', { requestId: request.id });
    }
  } catch (error) {
    request.log.error({ err: error }, 'new-device alert: not noted');
  }
}
