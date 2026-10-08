import type { Mail } from './mailer.ts';

/**
 * The messages Robis sends.
 *
 * Bodies live here rather than inline in the route handlers so there is one
 * place that assembles a link, and so the wording can be asserted. Plain text
 * only: an HTML mail needs a text alternative anyway, and the text version is
 * the one that always renders.
 */

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
      'Your account already works without this -- verifying only confirms the',
      'address belongs to you.',
    ].join('\n'),
  };
}
