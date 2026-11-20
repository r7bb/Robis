import { DraftLegalPage } from '../../components/legal/draft-page.tsx';

export const metadata = { title: 'Privacy (draft) · Robis' };

export default function PrivacyPage() {
  return (
    <DraftLegalPage title="Privacy notice">
      <p>
        What the code stores, described plainly. It is not a statement of compliance with any law.
      </p>
      <h2>Your account</h2>
      <p>
        Your email address (to sign in and recover the account), your name, your username, and a
        password hash. Accounts that existed before usernames were given one made from the start of
        their email address; it can be changed in Account. The password itself is never stored.
        Sessions record when they were used and the browser's user agent, so you can see and revoke
        them in Account. Each browser you sign in from also keeps a random cookie of its own, stored
        here only as a hash, so that a sign-in from a browser you have not used before can be
        emailed to you. A browser not seen for 400 days is forgotten. A passkey you add is kept as
        its public key, the name you give it, and when it was added and last used; its private key
        stays on your device.
      </p>
      <h2>Inside a workspace</h2>
      <p>
        What you create there, and an audit trail of changes. The trail names people by username and
        id, not by email, and is kept for as long as the workspace exists, including after an
        account is deleted. It also records when a workspace admin reads, exports or checks it.
        Admins can still see the usernames of people who have left a workspace, next to their past
        events. For events recorded from October 2026 on, a username can be erased from the trail on
        request; how and when that is done is for review. How long the trail should be kept is an
        open question for review.
      </p>
      <p>
        Photos you share (on issues, in chat, as stories, on your profile and on the feed) are
        stored without their location or camera details and shown only to members of that workspace.
        Stories go after 24 hours. When you delete your account, your stories, profile covers, photo
        posts and reactions on the feed go with it; the words you wrote, your chat messages and
        pictures, and images on issues stay in the workspace under &ldquo;Deleted user&rdquo;.
        Whether that is the right line is for review.
      </p>
      <h2>Your account history</h2>
      <p>
        Robis records when your account is signed in to, a sign-in fails, you sign out, your
        password is changed or reset, and other sessions are signed out. Only you can see this
        history, in Account settings. It does not record where a sign-in came from.
      </p>
      <h2>Who sees what</h2>
      <p>
        Only members of a workspace see its contents. Teammates see each other's name and username;
        email addresses are shown only to the workspace's admins and owners.
      </p>
      <h2>Sent elsewhere</h2>
      <p>
        Issue titles and descriptions are sent to the project's own ML service for duplicate and
        priority hints. If an operator configures a SIEM stream, the audit trail is sent to it.
        Nothing is sold or shared with advertisers.
      </p>
    </DraftLegalPage>
  );
}
