import { z } from 'zod';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
  uuid,
} from '../schemas.ts';
import { avatar } from './common.ts';
import { contract, timestamp } from './contract.ts';

/** Who an account is, as it is shown back to its owner. */
const publicUser = z.object({
  id: uuid,
  email: z.string(),
  name: z.string(),
  /** The app-specific `@handle`. */
  username: z.string(),
});

/** Your own account, with what the app asks before anything else. */
const me = publicUser.extend({
  /** Null until a picture is chosen; the welcome step asks for one. */
  avatar,
  /**
   * Whether the current terms are agreed to. When `needed`, the app asks
   * before anything else and the server refuses workspace use.
   */
  consent: z.object({
    needed: z.boolean(),
    termsVersion: z.string().nullable(),
    current: z.string(),
  }),
  /** False for an account whose username was given to it; asked once. */
  usernameConfirmed: z.boolean(),
  /** Whether the address has been confirmed. Joining a workspace needs it. */
  emailVerified: z.boolean(),
  emailVerifiedAt: timestamp.nullable(),
});

const ok = z.object({ ok: z.literal(true) });

export const authContracts = {
  'auth.register': contract({
    method: 'POST',
    path: '/auth/register',
    summary: 'Make an account from a sign-up link, and sign in.',
    body: registerSchema,
    status: 201,
    response: z.object({ user: publicUser }),
  }),
  'auth.login': contract({
    method: 'POST',
    path: '/auth/login',
    summary: 'Sign in; the session is a cookie.',
    body: loginSchema,
    response: z.object({ user: publicUser }),
  }),
  'auth.logout': contract({
    method: 'POST',
    path: '/auth/logout',
    summary: 'Sign out of this browser.',
    response: ok,
  }),
  'auth.me': contract({
    method: 'GET',
    path: '/auth/me',
    summary: 'Your own account.',
    response: z.object({ user: me }),
  }),
  'auth.updateMe': contract({
    method: 'PATCH',
    path: '/auth/me',
    summary: 'Change your name or username; an old username is held for 90 days.',
    body: updateProfileSchema,
    response: z.object({ user: publicUser }),
  }),
  'auth.usernameAvailable': contract({
    method: 'GET',
    path: '/auth/username-available',
    summary: 'Whether a username can be had, and if not, why.',
    // Anything but one string (a repeated parameter, say) is simply not a username.
    query: z.object({ username: z.unknown().optional() }),
    response: z.object({
      username: z.string(),
      available: z.boolean(),
      reason: z.string().nullable(),
    }),
  }),
  'auth.changePassword': contract({
    method: 'POST',
    path: '/auth/password',
    summary: 'Change your password; every other session ends.',
    body: changePasswordSchema,
    response: ok,
  }),
  'auth.sessions': contract({
    method: 'GET',
    path: '/auth/sessions',
    summary: 'Where you are signed in.',
    response: z.object({
      sessions: z.array(
        z.object({
          id: uuid,
          createdAt: timestamp,
          lastUsedAt: timestamp,
          userAgent: z.string().nullable(),
          current: z.boolean(),
        }),
      ),
    }),
  }),
  'auth.revokeSessions': contract({
    method: 'DELETE',
    path: '/auth/sessions',
    summary: 'Sign out everywhere but here.',
    response: z.object({ revoked: z.number().int() }),
  }),
} as const;
