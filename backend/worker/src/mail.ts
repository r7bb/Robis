import { generateSessionToken, hashSessionToken, issueAuthToken, ttlMinutesFor } from '@robis/auth';
import {
  type AccountMailPayload,
  type InvitationMailPayload,
  MAIL_EMAIL_VERIFICATION_JOB,
  MAIL_PASSWORD_RESET_JOB,
  MAIL_SIGNUP_EXISTING_JOB,
  MAIL_SIGNUP_JOB,
  MAIL_WORKSPACE_INVITATION_JOB,
  type SignupMailPayload,
  signups,
  users,
  workspaceInvitations,
  workspaces,
} from '@robis/database';
import {
  linkFor,
  type Mailer,
  passwordResetMail,
  signupExistingMail,
  signupMail,
  verifyEmailMail,
  workspaceInvitationMail,
} from '@robis/mailer';
import { eq } from 'drizzle-orm';
import type { Handlers } from './runner.ts';

/** How long a link to finish signing up works. */
export const SIGNUP_LINK_MINUTES = 24 * 60;

/**
 * Sending account mail.
 *
 * Each job carries only an account id. The token is issued here, at send
 * time, which also means a retry sends a fresh link: issuing replaces the
 * previous token for that purpose.
 *
 * The cost of that, stated: if a server accepts a message and the reply is
 * then lost, the retry delivers a second email and the first one's link no
 * longer works. The newest email always does, and the reset page says to
 * ask again. Storing the link so a retry could resend the same one would put
 * a live credential in the jobs table, which is the thing this avoids.
 */
export function mailHandlers(deps: { mailer: Mailer; webOrigin: string }): Handlers {
  const { mailer, webOrigin } = deps;

  return {
    [MAIL_PASSWORD_RESET_JOB]: async (payload, { db }) => {
      const { userId } = payload as AccountMailPayload;
      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // The account is gone: there is no one to send it to, and retrying will
      // never change that.
      if (!user) return;

      const { token } = await issueAuthToken(db, userId, 'password_reset');
      await mailer.send(
        passwordResetMail(
          user.email,
          linkFor(webOrigin, '/reset-password', token),
          ttlMinutesFor('password_reset'),
        ),
      );
    },

    [MAIL_EMAIL_VERIFICATION_JOB]: async (payload, { db }) => {
      const { userId } = payload as AccountMailPayload;
      const [user] = await db
        .select({ email: users.email, verifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      // Gone, or confirmed since this was queued: nothing left to ask.
      if (!user || user.verifiedAt) return;

      const { token } = await issueAuthToken(db, userId, 'email_verification');
      await mailer.send(
        verifyEmailMail(
          user.email,
          linkFor(webOrigin, '/verify-email', token),
          ttlMinutesFor('email_verification'),
        ),
      );
    },

    [MAIL_SIGNUP_JOB]: async (payload, { db }) => {
      const { signupId } = payload as SignupMailPayload;
      // Issued here, at send time, as account links are: the link itself is
      // never written down. Each request has its own row, so asking again
      // sends a second link and leaves the first one working.
      const token = generateSessionToken();
      const [signup] = await db
        .update(signups)
        .set({
          tokenHash: hashSessionToken(token),
          expiresAt: new Date(Date.now() + SIGNUP_LINK_MINUTES * 60_000),
        })
        .where(eq(signups.id, signupId))
        .returning({ email: signups.email });
      // Finished in the meantime: nothing to send.
      if (!signup) return;

      await mailer.send(
        signupMail(signup.email, linkFor(webOrigin, '/signup', token), SIGNUP_LINK_MINUTES),
      );
    },

    [MAIL_SIGNUP_EXISTING_JOB]: async (payload, { db }) => {
      const { userId } = payload as AccountMailPayload;
      const [user] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user) return;
      await mailer.send(
        signupExistingMail(user.email, {
          signIn: `${webOrigin}/login`,
          reset: `${webOrigin}/forgot-password`,
        }),
      );
    },

    [MAIL_WORKSPACE_INVITATION_JOB]: async (payload, { db }) => {
      const { invitationId } = payload as InvitationMailPayload;
      const [invitation] = await db
        .select({
          email: workspaceInvitations.email,
          workspaceName: workspaces.name,
          invitedBy: users.username,
        })
        .from(workspaceInvitations)
        .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
        .leftJoin(users, eq(users.id, workspaceInvitations.invitedBy))
        .where(eq(workspaceInvitations.id, invitationId))
        .limit(1);
      // Answered or withdrawn before it went: nothing to say any more.
      if (!invitation?.email) return;

      await mailer.send(
        workspaceInvitationMail(invitation.email, {
          workspaceName: invitation.workspaceName,
          invitedBy: invitation.invitedBy,
          link: `${webOrigin}/login`,
        }),
      );
    },
  };
}
