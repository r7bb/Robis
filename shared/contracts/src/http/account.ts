import { z } from 'zod';
import { generatedAvatarSchema } from '../avatars.ts';
import { consentSchema } from '../consent.ts';
import {
  deleteAccountSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  signupStartSchema,
  verifyEmailSchema,
} from '../schemas.ts';
import { avatar } from './common.ts';
import { contract } from './contract.ts';

const ok = z.object({ ok: z.literal(true) });

export const accountContracts = {
  'auth.signup': contract({
    method: 'POST',
    path: '/auth/signup',
    summary:
      'Start signing up: a link goes to the address, and the answer is the same whether or not it has an account.',
    body: signupStartSchema,
    status: 202,
    response: z.object({ status: z.literal('check_inbox') }),
  }),
  'auth.forgotPassword': contract({
    method: 'POST',
    path: '/auth/password/forgot',
    summary:
      'Ask for a reset link. Always 202, whatever was sent, so the answer never says whether an address has an account.',
    body: forgotPasswordSchema,
    // A body that does not parse is not refused: refusing it would answer
    // differently from an address with no account.
    lenientBody: true,
    status: 202,
    response: ok,
  }),
  'auth.resetPassword': contract({
    method: 'POST',
    path: '/auth/password/reset',
    summary: 'Set a new password from a reset link; every session ends.',
    body: resetPasswordSchema,
    response: ok,
  }),
  'auth.verifyEmail': contract({
    method: 'POST',
    path: '/auth/email/verify',
    summary: 'Confirm your address from the link that was mailed to it.',
    body: verifyEmailSchema,
    response: ok,
  }),
  'auth.resendVerification': contract({
    method: 'POST',
    path: '/auth/email/resend',
    summary: 'Mail the confirmation link again, unless the address is confirmed already.',
    response: z.object({ ok: z.literal(true), alreadyVerified: z.boolean() }),
  }),
  'auth.consent': contract({
    method: 'POST',
    path: '/auth/me/consent',
    summary: 'Agree to the current terms.',
    body: consentSchema,
    response: z.object({
      consent: z.object({
        needed: z.literal(false),
        termsVersion: z.string(),
        current: z.string(),
      }),
    }),
  }),
  'auth.confirmUsername': contract({
    method: 'POST',
    path: '/auth/me/username/confirm',
    summary: 'Keep the username an account was given, once asked.',
    response: z.object({ usernameConfirmed: z.literal(true) }),
  }),
  'auth.events': contract({
    method: 'GET',
    path: '/auth/me/events',
    summary: "A page of your own account's trail: sign-ins, password and username changes.",
    query: z.object({
      before: z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }),
    response: z.object({
      events: z.array(
        z.object({
          seq: z.number().int(),
          type: z.string(),
          payload: z.record(z.string(), z.unknown()),
          occurredAt: z.string(),
        }),
      ),
      nextCursor: z.number().int().nullable(),
    }),
  }),
  'auth.verifyEvents': contract({
    method: 'POST',
    path: '/auth/me/events/verify',
    summary: "Check your account trail's chain; names the first bad link.",
    response: z.object({
      ok: z.boolean(),
      checked: z.number().int(),
      broken: z
        .object({
          seq: z.number().int(),
          reason: z.enum(['missing', 'altered', 'relinked', 'unverifiable']),
        })
        .nullable(),
    }),
  }),
  'auth.deleteAccount': contract({
    method: 'DELETE',
    path: '/auth/me',
    summary:
      'Delete your account, with your password and a decision for every workspace you alone own (409 lists the undecided).',
    body: deleteAccountSchema,
    status: 204,
    response: null,
  }),
  'auth.uploadAvatar': contract({
    method: 'PUT',
    path: '/auth/me/avatar',
    summary: 'Use a photo as your picture; it is re-encoded small and stripped of metadata.',
    rawBody: 'image/*',
    response: z.object({ avatar }),
  }),
  'auth.generatedAvatar': contract({
    method: 'PUT',
    path: '/auth/me/avatar/generated',
    summary: 'Use a generated picture, drawn by the web app from its seed.',
    body: generatedAvatarSchema,
    response: z.object({ avatar }),
  }),
} as const;
