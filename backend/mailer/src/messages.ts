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
  // Two days or more, in whole days, reads as days: "7 days", not "168 hours".
  if (hours >= 48 && hours % 24 === 0) return `${hours / 24} days`;

  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];
const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

/** "Chrome on macOS", from what the browser said of itself, as far as it can be read. */
export function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return 'An unknown browser';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : 'An unknown browser');
}

/** "19 November 2026 at 04:50 UTC": one zone for everyone, said plainly. */
function whenInUtc(at: Date): string {
  const day = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  });
  return `${day} at ${time} UTC`;
}

/**
 * A sign-in from a browser the account had not used (C4), with a link that
 * signs out everywhere if it was not them. The link leads to a page that
 * asks first, so a mail scanner opening it changes nothing.
 */
export function newDeviceMail(
  to: string,
  sign: { browser: string | null; at: Date },
  notMeLink: string,
  expiresInMinutes: number,
): Mail {
  return {
    to,
    subject: 'New sign-in to your Robis account',
    text: [
      'Your Robis account was just signed in to from a browser it had not used before:',
      '',
      `  ${describeBrowser(sign.browser)}, ${whenInUtc(sign.at)}`,
      '',
      'If that was you, there is nothing to do.',
      '',
      'If it was not, open this link to sign out of Robis everywhere:',
      notMeLink,
      '',
      `The link works once, for ${humanDuration(expiresInMinutes)}. Then reset your`,
      'password, as whoever signed in knows it.',
    ].join('\n'),
  };
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

/**
 * A notification as one line of plain text (C3): who did what to which
 * thing. Every field is text someone typed in Robis, passed through as text.
 */
export type NotificationLine = {
  kind: string;
  actor: string | null;
  issueKey?: string | null;
  issueTitle?: string | null;
  excerpt?: string;
  title?: string;
  body?: string;
  change?: string;
  link: string;
};

const MEETING_DID: Record<string, string> = {
  moved: 'moved',
  changed: 'changed',
  canceled: 'called off',
};

/** Control characters, zero-width ones and the marks that reverse text: never shown as meant. */
function isInvisible(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * Text someone typed, made one plain line for an email (C3): every run of
 * whitespace one space, invisible and direction-changing characters gone.
 * A comment cannot then start a line of its own and pose as the email's
 * own text (a forged unsubscribe link, say), nor hide what it says.
 */
export function oneLine(text: string | null | undefined): string {
  const spaced = (text ?? '').replace(/\s+/g, ' ');
  const visible = [...spaced].filter((char) => !isInvisible(char.codePointAt(0) ?? 0)).join('');
  return visible.replace(/ {2,}/g, ' ').trim();
}

/** Every typed field of a line, made one plain line. */
function cleaned(item: Omit<NotificationLine, 'kind' | 'link'>) {
  return {
    actor: oneLine(item.actor) || 'Someone',
    issueKey: oneLine(item.issueKey) || null,
    issueTitle: oneLine(item.issueTitle),
    excerpt: oneLine(item.excerpt),
    title: oneLine(item.title),
    body: oneLine(item.body),
    change: oneLine(item.change),
  };
}

export function notificationLine(item: NotificationLine): string {
  const c = cleaned(item);
  const issue = c.issueKey ?? 'an issue';
  const said = (text: string) => (text ? `: ${text}` : '');
  switch (item.kind) {
    case 'assignment':
      return `${c.actor} gave you ${issue}${said(c.issueTitle)}`;
    case 'issue_comment':
      return `${c.actor} commented on ${issue}${said(c.excerpt)}`;
    case 'meeting':
      return `${c.actor} ${MEETING_DID[c.change] ?? 'changed'} ${c.title || 'a meeting'}`;
    case 'nudge':
      return [c.title, c.body].filter(Boolean).join(': ');
    case 'space_reply':
      return `${c.actor} replied in ${c.title || 'a thread'}${said(c.excerpt)}`;
    case 'space_answer':
      return `${c.actor} marked your reply as the answer to ${c.title || 'a question'}`;
    case 'cycle_ending':
      return `${c.title || 'A cycle'} ends tomorrow${said(c.body)}`;
    default:
      return `${c.actor} mentioned you on ${issue}${said(c.excerpt)}`;
  }
}

/** The end of every notification email: how to stop it, and where to choose. */
function footer(links: { unsubscribe: string; settings: string }, what: string): string[] {
  return [
    '',
    '',
    `You get this because ${what} by email is on.`,
    `Stop these emails: ${links.unsubscribe}`,
    `Choose what you hear about: ${links.settings}`,
    'Robis never asks for your password by email.',
  ];
}

/** The header that lets a mail client offer its own unsubscribe button. */
function unsubscribeHeaders(link: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${link}>` };
}

/** A mention, sent as it happens. */
export function mentionMail(
  to: string,
  item: Omit<NotificationLine, 'kind'>,
  links: { unsubscribe: string; settings: string },
): Mail {
  const c = cleaned(item);
  const on = c.issueKey ? ` on ${c.issueKey}` : '';
  return {
    to,
    subject: `${c.actor} mentioned you${on}`,
    text: [
      `${c.actor} mentioned you${on}${c.issueTitle ? `, ${c.issueTitle}` : ''}:`,
      '',
      `  ${c.excerpt}`,
      '',
      `Open it: ${item.link}`,
      ...footer(links, 'mentions'),
    ].join('\n'),
    headers: unsubscribeHeaders(links.unsubscribe),
  };
}

/** The day's summary: everything else, one line and link each. */
export function digestMail(
  to: string,
  items: readonly NotificationLine[],
  links: { unsubscribe: string; settings: string },
): Mail {
  const count = items.length === 1 ? '1 update' : `${items.length} updates`;
  return {
    to,
    subject: `Your Robis summary: ${count}`,
    text: [
      'Since your last summary:',
      '',
      ...items.flatMap((item) => [`${notificationLine(item)}`, `  ${item.link}`, '']),
      ...footer(links, 'this summary').slice(1),
    ].join('\n'),
    headers: unsubscribeHeaders(links.unsubscribe),
  };
}
