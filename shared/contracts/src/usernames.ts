import { z } from 'zod';

/**
 * App-specific usernames: the `@handle` people know each other by.
 *
 * Before these, the handle was the local part of an email address, which
 * meant a mention, a member list and the audit trail all carried a piece of
 * someone's email. A username is chosen for this app, can be changed, and
 * says nothing about where its owner gets mail.
 *
 * Lowercase letters, digits, `.` and `_`; 3 to 30 characters; starting and
 * ending with a letter or digit; no `..`. Narrow on purpose: every character
 * allowed here is one the mention grammar already treats as part of a
 * handle, so "@name" in text always means the whole username.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

const USERNAME = /^[a-z0-9](?:[a-z0-9._]*[a-z0-9])?$/;

/**
 * Names that would read as the system speaking, or as a group mention, if
 * a person held them.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'abuse',
  'admin',
  'administrator',
  'all',
  'api',
  'billing',
  'channel',
  'everyone',
  'help',
  'here',
  'legal',
  'me',
  'mod',
  'moderator',
  'noreply',
  'null',
  'owner',
  'postmaster',
  'privacy',
  'robis',
  'root',
  'security',
  'staff',
  'support',
  'system',
  'team',
  'undefined',
  'webmaster',
  'www',
]);

export type UsernameProblem = 'length' | 'characters' | 'reserved';

/** Why a candidate is not a valid username, or null if it is. */
export function usernameProblem(candidate: string): UsernameProblem | null {
  if (candidate.length < USERNAME_MIN_LENGTH || candidate.length > USERNAME_MAX_LENGTH) {
    return 'length';
  }
  if (!USERNAME.test(candidate) || candidate.includes('..')) return 'characters';
  if (RESERVED_USERNAMES.has(candidate)) return 'reserved';
  return null;
}

export const USERNAME_HINT =
  '3 to 30 lowercase letters, digits, dots or underscores, starting and ending with a letter or digit.';

/** Lowercased and trimmed first, so "Ada" and "ada " are the same request. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, context) => {
    const problem = usernameProblem(value);
    if (problem === 'reserved') {
      context.addIssue({ code: 'custom', message: 'That username is reserved' });
    } else if (problem) {
      context.addIssue({ code: 'custom', message: USERNAME_HINT });
    }
  });
