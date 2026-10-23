import type { Mail } from './mailer.ts';

/**
 * The messages Robis sends.
 *
 * Bodies live here rather than inline in the route handlers so there is one
 * place that assembles a link, and so the wording can be asserted. Plain text
 * only: an HTML mail needs a text alternative anyway, and the text version is
 * the one that always renders.
 */

/**
 * A link the recipient can click, from the configured web origin.
 *
 * Never from a request's `Host` header: trusting it would let an attacker who
 * can reach the API request a reset for someone else and have the link point
 * at a host they control.
 */
export function linkFor(webOrigin: string, path: string, token: string): string {
  return `${webOrigin}${path}?token=${encodeURIComponent(token)}`;
}

/** "30 minutes" or "24 hours", whichever reads naturally for the duration. */
function humanDuration(minutes: number): string {
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${minutes} minutes`;

  const hours = minutes / 60;
  if (!Number.isInteger(hours)) return `${minutes} minutes`;

  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/**
 * A reset link.
 *
 * This message goes to an address that may not have asked for it -- anyone can
 * type someone else's address into the form -- so it has to say plainly that
 * nothing has changed and that ignoring it is safe. It must never state
 * whether the address has an account either, though the mail only arrives if
 * it does.
 */
export function passwordResetMail(to: string, link: string, expiresInMinutes: number): Mail {
  return {
    to,
    subject: 'Reset your Robis password',
    text: [
      'Someone asked to reset the password for this Robis account.',
      '',
      'Open this link to choose a new one:',
      link,
      '',
      `The link works once and expires in ${humanDuration(expiresInMinutes)}.`,
      '',
      "If you didn't ask for this you can ignore this message -- your password",
      'has not changed and nobody has been signed in.',
    ].join('\n'),
  };
}

/** A confirmation link for an address that has just been registered. */
export function verifyEmailMail(to: string, link: string, expiresInMinutes: number): Mail {
  return {
    to,
    subject: 'Verify your Robis email address',
    text: [
      'Welcome to Robis. Confirm this address so we know it reaches you:',
      '',
      link,
      '',
      `The link works once and expires in ${humanDuration(expiresInMinutes)}.`,
      '',
      'Your account already works without this. Confirming the address lets',
      'you join the workspaces you are invited to.',
    ].join('\n'),
  };
}

/**
 * An invitation to a workspace, sent to an address.
 *
 * The same words whether or not the address has an account, and it never
 * says which: the link goes to the sign-in page, which offers both. The
 * workspace name is written by whoever made it, so it is quoted as a name
 * and the only link is to this site.
 */
export function workspaceInvitationMail(
  to: string,
  details: { workspaceName: string; invitedBy: string | null; link: string },
): Mail {
  const who = details.invitedBy ? `@${details.invitedBy}` : 'Someone';
  return {
    to,
    subject: 'You have been invited to a workspace on Robis',
    text: [
      `${who} invited this address to join the workspace "${details.workspaceName}" on Robis.`,
      '',
      'Sign in, or create an account with this address, to accept or decline:',
      details.link,
      '',
      'Nothing happens unless you accept. If you were not expecting this, you',
      'can ignore it.',
    ].join('\n'),
  };
}

/**
 * The link that finishes signing up. Opening it is what proves the
 * address, so the account it makes starts with the address confirmed.
 */
export function signupMail(to: string, link: string, expiresInMinutes: number): Mail {
  return {
    to,
    subject: 'Finish signing up for Robis',
    text: [
      'Someone asked to create a Robis account with this address.',
      '',
      'Open this link to choose your name, username and password:',
      link,
      '',
      `The link works once and expires in ${humanDuration(expiresInMinutes)}.`,
      '',
      'If this was not you, ignore this message; no account has been made.',
    ].join('\n'),
  };
}

/**
 * For an address that already has an account, in place of a sign-up
 * link: the form said "check your inbox" either way, so only the owner of
 * the inbox learns which it was.
 */
export function signupExistingMail(to: string, links: { signIn: string; reset: string }): Mail {
  return {
    to,
    subject: 'You already have a Robis account',
    text: [
      'Someone asked to create a Robis account with this address, but it',
      'already has one, so nothing new was made.',
      '',
      'Sign in here:',
      links.signIn,
      '',
      'Forgotten the password? Reset it here:',
      links.reset,
      '',
      'If this was not you, you can ignore this message.',
    ].join('\n'),
  };
}
