import { createSession } from '@robis/auth';
import type { Database } from '@robis/database';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from './env.ts';

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
  const { token, expiresAt } = await createSession(db, userId, request.headers['user-agent']);
  reply.setCookie(request.server.sessionCookieName, token, {
    ...sessionCookieOptions(env),
    expires: expiresAt,
  });
}
