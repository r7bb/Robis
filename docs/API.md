# Robis API reference

Every route the API serves through a contract, grouped by what it is for.
Generated from the Zod contracts that the server validates against, by
`bun run openapi`; the same contracts make [openapi.json](openapi.json),
which a running server also serves at `/api/openapi.json`. Do not edit
this file by hand.

**Address.** Every path is under `/api` on the site's own address.

**Signing in.** A browser sends its session cookie. A script sends a
personal access token, made on the account page, as
`Authorization: Bearer rbp_…`: it acts as its owner on routes under
`/workspaces/{workspaceId}` only, and without the write scope it may only
read (any other method answers 403). Agents send their own tokens the same
way.

**Answers.** JSON, with the status shown. A refusal is
`{ "error": "<code>", "message": "<words for people>" }`. A stranger to a
workspace gets 404, never 403, so its existence is not given away.

178 routes.

## activity

### `GET /workspaces/{workspaceId}/activity`

The last 100 things that happened in a workspace, newest first.

- Answers: 200
- Name: `workspaces.activity`

## agents

### `GET /workspaces/{workspaceId}/agents`

A workspace's agents and their tokens, for its admins.

- Answers: 200
- Name: `agents.list`

### `POST /workspaces/{workspaceId}/agents`

Add an agent as a member or guest, with a first token shown once.

- Body: `name` (required), `role` (required), `tokenLabel`, `triage`, `summaries`, `shots`, `pictures`
- Answers: 201
- Name: `agents.create`

### `DELETE /workspaces/{workspaceId}/agents/{agentId}`

Remove an agent: its tokens stop working and it leaves the workspace.

- Answers: 204
- Name: `agents.remove`

### `POST /workspaces/{workspaceId}/agents/{agentId}/tokens`

Give an agent another token, shown once.

- Body: `label` (required)
- Answers: 201
- Name: `agents.issueToken`

### `DELETE /workspaces/{workspaceId}/agents/{agentId}/tokens/{tokenId}`

Revoke one of an agent's tokens; the next call carrying it is refused.

- Answers: 204
- Name: `agents.revokeToken`

### `GET /workspaces/{workspaceId}/agents/activity`

What the workspace's agents did: their latest runs step by step, and what people did with their changes.

- Answers: 200
- Name: `agents.activity`

### `GET /workspaces/{workspaceId}/agents/changes`

The agents' latest changes, newest first: what each set from what to what, and whether it can be undone.

- Answers: 200
- Name: `agents.changes`

### `POST /workspaces/{workspaceId}/agents/changes/{changeId}/undo`

Undo an agent's change: put a field back, or remove a comment it wrote; refused once someone has changed it since.

- Answers: 200
- Name: `agents.undoChange`

## attachments

### `DELETE /workspaces/{workspaceId}/attachments/{attachmentId}`

Remove an image you added, or as an admin, any.

- Answers: 204
- Name: `attachments.delete`

## audit

### `GET /workspaces/{workspaceId}/audit/actors`

Everyone who appears in the trail, members first, former members after.

- Answers: 200
- Name: `audit.actors`

### `GET /workspaces/{workspaceId}/audit/events`

A page of a workspace's audit trail: newest first, or from a sequence number onwards for an export.

- Query: `after`, `before`, `limit`, `actorId`, `entityType`
- Answers: 200
- Name: `audit.events`

### `POST /workspaces/{workspaceId}/audit/verify`

Check the chain, from the last signed checkpoint, or from the start with full=1; names the first bad link.

- Query: `full`
- Answers: 200
- Name: `audit.verify`

## auth

### `POST /auth/email/resend`

Mail the confirmation link again, unless the address is confirmed already.

- Answers: 200
- Name: `auth.resendVerification`

### `POST /auth/email/verify`

Confirm your address from the link that was mailed to it.

- Body: `token` (required)
- Answers: 200
- Name: `auth.verifyEmail`

### `POST /auth/login`

Sign in; the session is a cookie. With two-factor on, a challenge comes back instead.

- Body: `email` (required), `password` (required)
- Answers: 200
- Name: `auth.login`

### `POST /auth/login/two-factor`

Finish a sign-in with a code from the app or a recovery code.

- Body: `challenge` (required), `code` (required)
- Answers: 200
- Name: `auth.loginTwoFactor`

### `POST /auth/logout`

Sign out of this browser.

- Answers: 200
- Name: `auth.logout`

### `DELETE /auth/me`

Delete your account, with your password and a decision for every workspace you alone own (409 lists the undecided).

- Body: `password` (required), `workspaces`
- Answers: 204
- Name: `auth.deleteAccount`

### `GET /auth/me`

Your own account.

- Answers: 200
- Name: `auth.me`

### `PATCH /auth/me`

Change your name or username; an old username is held for 90 days.

- Body: `name`, `username`
- Answers: 200
- Name: `auth.updateMe`

### `PUT /auth/me/avatar`

Use a photo as your picture; it is re-encoded small and stripped of metadata.

- Body: the file itself, as `image/*`
- Answers: 200
- Name: `auth.uploadAvatar`

### `PUT /auth/me/avatar/generated`

Use a generated picture, drawn by the web app from its seed.

- Body: `seed` (required)
- Answers: 200
- Name: `auth.generatedAvatar`

### `POST /auth/me/consent`

Agree to the current terms.

- Body: `termsVersion` (required), `ageConfirmed` (required)
- Answers: 200
- Name: `auth.consent`

### `GET /auth/me/events`

A page of your own account's trail: sign-ins, password and username changes.

- Query: `before`, `limit`
- Answers: 200
- Name: `auth.events`

### `POST /auth/me/events/verify`

Check your account trail's chain; names the first bad link.

- Answers: 200
- Name: `auth.verifyEvents`

### `POST /auth/me/username/confirm`

Keep the username an account was given, once asked.

- Answers: 200
- Name: `auth.confirmUsername`

### `POST /auth/not-me`

From a new-device alert: it was not me. Every session ends and every browser is forgotten.

- Body: `token` (required)
- Answers: 200
- Name: `auth.notMe`

### `POST /auth/passkey`

Sign in with a passkey’s answer; the session is a cookie.

- Body: `challengeId` (required), `response` (required)
- Answers: 200
- Name: `auth.passkeyLogin`

### `POST /auth/passkey/options`

Start signing in with a passkey: a challenge for any of them to answer.

- Answers: 200
- Name: `auth.passkeyOptions`

### `GET /auth/passkeys`

Your passkeys, without their keys.

- Answers: 200
- Name: `passkeys.list`

### `POST /auth/passkeys`

Finish adding a passkey with the authenticator’s answer.

- Body: `challengeId` (required), `name` (required), `response` (required)
- Answers: 200
- Name: `passkeys.register`

### `DELETE /auth/passkeys/{passkeyId}`

Remove one of your passkeys.

- Answers: 200
- Name: `passkeys.remove`

### `POST /auth/passkeys/options`

Start adding a passkey: asks for the password again, and a code too when two-factor is on.

- Body: `password` (required), `code`
- Answers: 200
- Name: `passkeys.registerOptions`

### `POST /auth/password`

Change your password; every other session ends.

- Body: `currentPassword` (required), `newPassword` (required)
- Answers: 200
- Name: `auth.changePassword`

### `POST /auth/password/forgot`

Ask for a reset link. Always 202, whatever was sent, so the answer never says whether an address has an account.

- Body: `email` (required)
- Answers: 202
- Name: `auth.forgotPassword`

### `POST /auth/password/reset`

Set a new password from a reset link; every session ends.

- Body: `token` (required), `newPassword` (required)
- Answers: 200
- Name: `auth.resetPassword`

### `POST /auth/register`

Make an account from a sign-up link, and sign in.

- Body: `token` (required), `name` (required), `username` (required), `password` (required), `ageConfirmed` (required), `termsVersion`
- Answers: 201
- Name: `auth.register`

### `DELETE /auth/sessions`

Sign out everywhere but here.

- Answers: 200
- Name: `auth.revokeSessions`

### `GET /auth/sessions`

Where you are signed in.

- Answers: 200
- Name: `auth.sessions`

### `POST /auth/signup`

Start signing up: a link goes to the address, and the answer is the same whether or not it has an account.

- Body: `email` (required)
- Answers: 202
- Name: `auth.signup`

### `GET /auth/two-factor`

Whether two-factor sign-in is on, and how many recovery codes are left.

- Answers: 200
- Name: `twoFactor.state`

### `POST /auth/two-factor/disable`

Turn two-factor off.

- Body: `password` (required), `code` (required)
- Answers: 200
- Name: `twoFactor.disable`

### `POST /auth/two-factor/enable`

Turn two-factor on with a first code from the app; answers with recovery codes.

- Body: `code` (required)
- Answers: 200
- Name: `twoFactor.enable`

### `POST /auth/two-factor/recovery-codes`

Replace every recovery code with a new set.

- Body: `password` (required), `code` (required)
- Answers: 200
- Name: `twoFactor.recoveryCodes`

### `POST /auth/two-factor/setup`

Start setting up an authenticator app: a new secret, shown once.

- Body: `password` (required)
- Answers: 200
- Name: `twoFactor.setup`

### `GET /auth/username-available`

Whether a username can be had, and if not, why.

- Query: `username`
- Answers: 200
- Name: `auth.usernameAvailable`

## automations

### `GET /workspaces/{workspaceId}/automations`

The workspace's automation rules, with a month of their runs by outcome.

- Answers: 200
- Name: `automations.list`

### `POST /workspaces/{workspaceId}/automations`

Add an automation rule: a trigger, conditions that must all hold, and one action.

- Body: `name` (required), `trigger` (required), `conditions`, `action` (required), `enabled`
- Answers: 201
- Name: `automations.create`

### `DELETE /workspaces/{workspaceId}/automations/{ruleId}`

Remove a rule; what it already did stays in the trail.

- Answers: 204
- Name: `automations.delete`

### `PATCH /workspaces/{workspaceId}/automations/{ruleId}`

Change a rule, or turn it off or on.

- Body: `name`, `trigger`, `conditions`, `action`, `enabled`
- Answers: 200
- Name: `automations.update`

### `GET /workspaces/{workspaceId}/automations/{ruleId}/runs`

A rule's last fifty runs, newest first, with any note (a chain stopped, an action that failed).

- Answers: 200
- Name: `automations.runs`

## calendar

### `GET /workspaces/{workspaceId}/calendar`

The workspace's meeting occurrences in a window of at most nine days, and the issues due on the dates it covers.

- Query: `from` (required), `to` (required), `firstDay` (required), `lastDay` (required)
- Answers: 200
- Name: `calendar.week`

## channels

### `GET /workspaces/{workspaceId}/channels`

A workspace's channels, by name.

- Answers: 200
- Name: `channels.list`

### `POST /workspaces/{workspaceId}/channels`

Open a channel; its name is normalised, and must be free.

- Body: `name` (required), `topic`
- Answers: 201
- Name: `channels.create`

### `DELETE /workspaces/{workspaceId}/channels/{channelId}`

Delete a channel and its messages.

- Answers: 204
- Name: `channels.delete`

### `PATCH /workspaces/{workspaceId}/channels/{channelId}`

Rename a channel or change its topic.

- Body: `name`, `topic`
- Answers: 200
- Name: `channels.update`

### `POST /workspaces/{workspaceId}/channels/{channelId}/images`

Post a picture to a channel as its own message; re-encoded and stripped of metadata, within the workspace’s storage limit.

- Body: the file itself, as `image/*`
- Answers: 201
- Name: `messages.createImage`

### `GET /workspaces/{workspaceId}/channels/{channelId}/messages`

A page of a channel's messages, newest first, with a cursor for the next.

- Query: `limit`, `cursor`
- Answers: 200
- Name: `messages.list`

### `POST /workspaces/{workspaceId}/channels/{channelId}/messages`

Post a message to a channel.

- Body: `body` (required)
- Answers: 201
- Name: `messages.create`

## check-in

### `POST /workspaces/{workspaceId}/check-in`

Answer this week's check-in: a post the team sees, and your profile's Working on line here.

- Body: `body` (required)
- Answers: 201
- Name: `posts.checkIn`

## comments

### `DELETE /workspaces/{workspaceId}/comments/{commentId}`

Delete your own comment, or as an admin, anyone's.

- Answers: 204
- Name: `comments.delete`

## documents

### `GET /workspaces/{workspaceId}/documents`

A workspace's documents, most recently changed first.

- Answers: 200
- Name: `documents.list`

### `POST /workspaces/{workspaceId}/documents`

Start a document, in the workspace or under one of its projects.

- Body: `title` (required), `projectId`
- Answers: 201
- Name: `documents.create`

### `DELETE /workspaces/{workspaceId}/documents/{documentId}`

Delete a document and its history.

- Answers: 204
- Name: `documents.delete`

### `GET /workspaces/{workspaceId}/documents/{documentId}`

One document, with its text as it stands.

- Answers: 200
- Name: `documents.get`

### `PATCH /workspaces/{workspaceId}/documents/{documentId}`

Rename a document.

- Body: `title`
- Answers: 200
- Name: `documents.update`

## exports

### `GET /workspaces/{workspaceId}/exports`

The latest exports of this workspace, newest first. Admins only.

- Answers: 200
- Name: `exports.list`

### `POST /workspaces/{workspaceId}/exports`

Ask for an export of everything the workspace owns; built by a job. Refused while one is being built. Admins only.

- Answers: 202
- Name: `exports.create`

### `POST /workspaces/{workspaceId}/exports/{exportId}/link`

A download address for a ready export: it works once, for 5 minutes, and only signed in as an admin of the workspace. Making another replaces it.

- Answers: 200
- Name: `exports.link`

## feed

### `GET /workspaces/{workspaceId}/feed`

The feed, newest first: posts and pictures from rooms, a page at a time; `seenAt` is where you last caught up.

- Query: `before`
- Answers: 200
- Name: `feed.list`

### `GET /workspaces/{workspaceId}/feed/celebrations`

Milestones from the last seven days worth a well done: a project finished, an issue milestone, an anniversary, a new teammate. Never for anyone who turned celebrations off, nor for agents.

- Answers: 200
- Name: `feed.celebrations`

### `GET /workspaces/{workspaceId}/feed/projects`

How each active project is doing, from its issues: open, done in the last seven days, overdue, urgent, and a state worked out from those (needs a look, on track, quiet or finished).

- Query: `today`
- Answers: 200
- Name: `feed.projects`

### `POST /workspaces/{workspaceId}/feed/seen`

Mark the feed caught up to now, for you.

- Answers: 200
- Name: `feed.seen`

## github

### `DELETE /workspaces/{workspaceId}/github`

Disconnect from GitHub; its webhook is refused from then on. Admins only.

- Answers: 204
- Name: `github.disconnect`

### `GET /workspaces/{workspaceId}/github`

Whether this workspace is connected to GitHub, and how. Admins only.

- Answers: 200
- Name: `github.link`

### `PATCH /workspaces/{workspaceId}/github`

Choose whether merging a linked pull request moves the issue to done. Admins only.

- Body: `moveToDone` (required)
- Answers: 200
- Name: `github.update`

### `POST /workspaces/{workspaceId}/github`

Connect to GitHub, or make a new secret: the secret for the repository webhook is in this answer and never again. Admins only.

- Body: `moveToDone` (required)
- Answers: 201
- Name: `github.connect`

## insights

### `GET /workspaces/{workspaceId}/insights/flow`

Each active project's cycle time and weekly throughput over twelve weeks, from status changes.

- Answers: 200
- Name: `insights.flow`

### `GET /workspaces/{workspaceId}/insights/health`

This workspace's hint acceptance and, for the server's operators, its job queue and a day of sync lag and live-update latency.

- Answers: 200
- Name: `insights.health`

## invitations

### `GET /invitations`

The invitations waiting for you, from any workspace.

- Answers: 200
- Name: `invitations.mine`

### `POST /invitations/{invitationId}/accept`

Join the workspace an invitation is for.

- Answers: 200
- Name: `invitations.accept`

### `POST /invitations/{invitationId}/decline`

Turn an invitation down.

- Answers: 204
- Name: `invitations.decline`

### `GET /workspaces/{workspaceId}/invitations`

Invitations from a workspace that have not been answered.

- Answers: 200
- Name: `invitations.sent`

### `DELETE /workspaces/{workspaceId}/invitations/{invitationId}`

Withdraw an invitation that has not been answered.

- Answers: 204
- Name: `invitations.withdraw`

## issue-keys

### `GET /workspaces/{workspaceId}/issue-keys/{key}`

The issue a key such as REL-4 names in this workspace, in any case.

- Answers: 200
- Name: `issues.byKey`

## issues

### `DELETE /workspaces/{workspaceId}/issues/{issueId}`

Delete an issue, its comments and its images.

- Answers: 204
- Name: `issues.delete`

### `GET /workspaces/{workspaceId}/issues/{issueId}`

One issue, with its labels, the issue it is part of, and its sub-issues.

- Answers: 200
- Name: `issues.get`

### `PATCH /workspaces/{workspaceId}/issues/{issueId}`

Change an issue: its title, description, status, priority, assignee, place on the board, due day or parent.

- Body: `title`, `description`, `status`, `priority`, `assigneeId`, `position`, `dueOn`, `parentId`
- Answers: 200
- Name: `issues.update`

### `GET /workspaces/{workspaceId}/issues/{issueId}/attachments`

An issue's images, its comments' included.

- Answers: 200
- Name: `attachments.list`

### `POST /workspaces/{workspaceId}/issues/{issueId}/attachments`

Add an image to an issue, or to one of its comments; it is re-encoded and stripped of metadata, within the workspace's storage limit.

- Body: the file itself, as `image/*`
- Query: `commentId`
- Answers: 201
- Name: `attachments.upload`

### `GET /workspaces/{workspaceId}/issues/{issueId}/comments`

An issue's comments, oldest first.

- Answers: 200
- Name: `comments.list`

### `POST /workspaces/{workspaceId}/issues/{issueId}/comments`

Comment on an issue; anyone it @mentions is told.

- Body: `body` (required)
- Answers: 201
- Name: `comments.create`

### `GET /workspaces/{workspaceId}/issues/{issueId}/discussion`

The newest chat messages that name this issue by its key, with their rooms.

- Answers: 200
- Name: `issues.discussion`

### `PUT /workspaces/{workspaceId}/issues/{issueId}/labels`

Set an issue's labels: exactly these, replacing what it had.

- Body: `labelIds` (required)
- Answers: 200
- Name: `issues.setLabels`

### `GET /workspaces/{workspaceId}/issues/{issueId}/pull-requests`

The pull requests that name this issue's key, with each one's state.

- Answers: 200
- Name: `issues.pullRequests`

### `POST /workspaces/{workspaceId}/issues/bulk`

Apply one change to many issues: a status, priority, assignee, a label on or off, or delete. Issues the caller may not change are skipped and reported with the reason.

- Body: `issueIds` (required), `change` (required)
- Answers: 200
- Name: `issues.bulk`

### `GET /workspaces/{workspaceId}/issues/suggestions`

Hints for a draft, from one call to the suggestion service: issues it may duplicate, and a suggested priority (or a refusal with the counts it needs, or null for nothing to say).

- Query: `title` (required), `description`
- Answers: 200
- Name: `issues.suggestions`

## labels

### `GET /workspaces/{workspaceId}/labels`

A workspace's labels, by name.

- Answers: 200
- Name: `labels.list`

### `POST /workspaces/{workspaceId}/labels`

Make a label; names are unique in a workspace, whatever their case.

- Body: `name` (required), `colour` (required)
- Answers: 201
- Name: `labels.create`

### `DELETE /workspaces/{workspaceId}/labels/{labelId}`

Delete a label; it comes off every issue that had it.

- Answers: 204
- Name: `labels.delete`

## me

### `DELETE /me/calendar-feed`

Revoke your calendar feed: its address answers 404 from now on.

- Answers: 204
- Name: `calendar.revokeFeed`

### `GET /me/calendar-feed`

Whether you have a calendar feed, and since when; never its address.

- Answers: 200
- Name: `calendar.feed`

### `POST /me/calendar-feed`

Make your calendar feed, replacing any other; its address is shown this once.

- Answers: 201
- Name: `calendar.createFeed`

### `GET /me/meetings`

Your meetings in a window (at most two days), in every workspace you are in, soonest first; called-off ones left out.

- Query: `from` (required), `to` (required)
- Answers: 200
- Name: `meetings.mine`

### `GET /me/notification-settings`

Your notification settings: each kind, on or off in the app, by email and by push.

- Answers: 200
- Name: `notificationSettings.get`

### `PUT /me/notification-settings`

Turn one kind on or off in one channel; returns every setting.

- Body: `kind` (required), `channel` (required), `enabled` (required)
- Answers: 200
- Name: `notificationSettings.set`

### `DELETE /me/push-subscriptions`

Stop pushes to this device.

- Body: `endpoint` (required)
- Answers: 204
- Name: `pushSubscriptions.remove`

### `POST /me/push-subscriptions`

Take pushes on this device; a device someone else had moves to you.

- Body: `endpoint` (required)
- Answers: 204
- Name: `pushSubscriptions.add`

### `GET /me/tokens`

Your live personal access tokens, never their secrets, with when each was last used.

- Answers: 200
- Name: `tokens.list`

### `POST /me/tokens`

Make a personal access token, with your password: read only, or read and write. Its secret is in this answer and never again.

- Body: `name` (required), `write` (required), `password` (required), `lifetimeDays` (required)
- Answers: 201
- Name: `tokens.create`

### `DELETE /me/tokens/{tokenId}`

Revoke one of your tokens; the next request that carries it is refused.

- Answers: 204
- Name: `tokens.revoke`

## meetings

### `GET /workspaces/{workspaceId}/meetings`

Upcoming meetings, soonest first (and those that ended in the last half hour), or past and called-off ones, latest first.

- Query: `scope`
- Answers: 200
- Name: `meetings.list`

### `POST /workspaces/{workspaceId}/meetings`

Schedule a meeting; the organiser is an attendee who has said yes.

- Body: `title` (required), `agenda`, `startsAt` (required), `durationMinutes`, `joinUrl`, `attendeeIds`, `timeZone`, `repeatCount`
- Answers: 201
- Name: `meetings.create`

### `DELETE /workspaces/{workspaceId}/meetings/{meetingId}`

Delete a meeting you organise.

- Answers: 204
- Name: `meetings.delete`

### `PATCH /workspaces/{workspaceId}/meetings/{meetingId}`

Change a meeting you organise, or call it off.

- Body: `title`, `agenda`, `startsAt`, `durationMinutes`, `joinUrl`, `timeZone`, `repeatCount`
- Answers: 200
- Name: `meetings.update`

### `POST /workspaces/{workspaceId}/meetings/{meetingId}/response`

Say whether you are coming.

- Body: `response` (required)
- Answers: 200
- Name: `meetings.respond`

### `POST /workspaces/{workspaceId}/meetings/import`

Schedule the meetings in an .ics file, invitees matched to the roster by address; what cannot be taken is listed with why.

- Body: the file itself, as `text/calendar`
- Query: `timeZone`
- Answers: 201
- Name: `meetings.import`

## members

### `GET /workspaces/{workspaceId}/members`

A workspace's members, in the order they joined.

- Answers: 200
- Name: `members.list`

### `POST /workspaces/{workspaceId}/members`

Invite someone by username (201, the invitation) or by address (202, sent whether or not it has an account).

- Body: `email`, `username`, `role` (required)
- Answers: 201, 202
- Name: `members.invite`

### `DELETE /workspaces/{workspaceId}/members/{userId}`

Remove a member, within your own authority.

- Answers: 204
- Name: `members.remove`

### `PATCH /workspaces/{workspaceId}/members/{userId}`

Change a member's role, within your own authority.

- Body: `role` (required)
- Answers: 200
- Name: `members.setRole`

### `DELETE /workspaces/{workspaceId}/members/me`

Leave a workspace; the last owner cannot.

- Answers: 204
- Name: `members.leave`

## messages

### `DELETE /workspaces/{workspaceId}/messages/{messageId}`

Delete your own message, or as an admin, anyone's.

- Answers: 204
- Name: `messages.delete`

## notifications

### `GET /notifications`

Your last 100 notifications, newest first, with how many are unread.

- Query: `unread`
- Answers: 200
- Name: `notifications.list`

### `DELETE /notifications/{notificationId}`

Dismiss a notification.

- Answers: 204
- Name: `notifications.delete`

### `POST /notifications/{notificationId}/read`

Mark one notification read.

- Answers: 200
- Name: `notifications.read`

### `POST /notifications/read-all`

Mark every notification read.

- Answers: 200
- Name: `notifications.readAll`

## people

### `GET /workspaces/{workspaceId}/people/{userId}`

A member's profile here: title, what they are working on, recent activity the viewer may read, and the images they shared.

- Answers: 200
- Name: `profiles.get`

### `PATCH /workspaces/{workspaceId}/people/me`

Change your title, what you are working on, or whether the Feed may celebrate you, in this workspace.

- Body: `title`, `workingOn`, `celebrate`
- Answers: 200
- Name: `profiles.update`

### `DELETE /workspaces/{workspaceId}/people/me/cover`

Remove the cover photo from your profile here.

- Answers: 204
- Name: `profiles.removeCover`

### `PUT /workspaces/{workspaceId}/people/me/cover`

Set the cover photo on your profile here; re-encoded and stripped of metadata.

- Body: the file itself, as `image/*`
- Answers: 200
- Name: `profiles.setCover`

## post-comments

### `DELETE /workspaces/{workspaceId}/post-comments/{commentId}`

Take down your comment, or as an admin, any.

- Answers: 204
- Name: `posts.deleteComment`

## posts

### `POST /workspaces/{workspaceId}/posts`

Post a few words to the feed.

- Body: `body` (required)
- Answers: 201
- Name: `posts.create`

### `DELETE /workspaces/{workspaceId}/posts/{postId}`

Take down your post, or as an admin, any.

- Answers: 204
- Name: `posts.delete`

### `PATCH /workspaces/{workspaceId}/posts/{postId}`

Change your post's words, or a photo's caption (empty clears it).

- Body: `body` (required)
- Answers: 200
- Name: `posts.update`

### `GET /workspaces/{workspaceId}/posts/{postId}/comments`

A post's comments, oldest first.

- Answers: 200
- Name: `posts.comments`

### `POST /workspaces/{workspaceId}/posts/{postId}/comments`

Comment on a post.

- Body: `body` (required)
- Answers: 201
- Name: `posts.comment`

### `DELETE /workspaces/{workspaceId}/posts/{postId}/reactions/{reaction}`

Take back a reaction.

- Answers: 204
- Name: `posts.unreact`

### `PUT /workspaces/{workspaceId}/posts/{postId}/reactions/{reaction}`

React to a post: celebrate, helpful or support.

- Answers: 204
- Name: `posts.react`

### `POST /workspaces/{workspaceId}/posts/photo`

Post a photo to the feed; re-encoded and stripped of metadata, within the workspace’s storage. Add words with posts.update. An X-Robis-Meme-Caption header (URI-encoded, up to 80 characters) draws it across the photo as a meme.

- Body: the file itself, as `image/*`
- Answers: 201
- Name: `posts.createPhoto`

## projects

### `GET /workspaces/{workspaceId}/projects`

A workspace's projects, oldest first, each with its count of open issues.

- Answers: 200
- Name: `projects.list`

### `POST /workspaces/{workspaceId}/projects`

Make a project; its key is derived from the name unless given.

- Body: `name` (required), `key`, `description`, `template`
- Answers: 201
- Name: `projects.create`

### `DELETE /workspaces/{workspaceId}/projects/{projectId}`

Delete a project and its issues.

- Answers: 204
- Name: `projects.delete`

### `GET /workspaces/{workspaceId}/projects/{projectId}`

One project.

- Answers: 200
- Name: `projects.get`

### `PATCH /workspaces/{workspaceId}/projects/{projectId}`

Rename a project, change its description, or archive it.

- Body: `name`, `description`, `archived`
- Answers: 200
- Name: `projects.update`

### `POST /workspaces/{workspaceId}/projects/{projectId}/import/csv`

Import issues from a CSV file whose first row names its columns (title, description, status, priority, labels, id).

- Body: the file itself, as `text/csv`
- Answers: 200
- Name: `imports.csv`

### `POST /workspaces/{workspaceId}/projects/{projectId}/import/github`

Import a GitHub repository's issues (not its pull requests), with labels and comments. The token, for a private repository or a higher rate limit, is used for this import alone and never kept.

- Body: `repo` (required), `token`
- Answers: 200
- Name: `imports.github`

### `POST /workspaces/{workspaceId}/projects/{projectId}/import/robis`

Import the issues of a Robis workspace export, with their labels and comments, into this board.

- Body: the file itself, as `application/zip`
- Answers: 200
- Name: `imports.robis`

### `GET /workspaces/{workspaceId}/projects/{projectId}/issues`

A page of a project's issues, newest first, with a cursor for the next.

- Query: `status`, `assigneeId`, `priority`, `labelId`, `limit`, `cursor`
- Answers: 200
- Name: `issues.list`

### `POST /workspaces/{workspaceId}/projects/{projectId}/issues`

File an issue; it takes the next number in its project.

- Body: `id`, `title` (required), `description`, `status`, `priority`, `assigneeId`, `dueOn`, `parentId`
- Answers: 201
- Name: `issues.create`

### `GET /workspaces/{workspaceId}/projects/{projectId}/views`

A project's saved board views, by name.

- Answers: 200
- Name: `savedViews.list`

### `POST /workspaces/{workspaceId}/projects/{projectId}/views`

Name and keep a board filter; names are unique in a project whatever their case, and so are filters.

- Body: `name` (required), `filter` (required)
- Answers: 201
- Name: `savedViews.create`

## push

### `GET /push/key`

The server's public push key, or null when web push is not set up.

- Answers: 200
- Name: `push.key`

## search

### `GET /workspaces/{workspaceId}/search`

Issues, documents and comments matching a query, best first; one kind with type, more with limit.

- Query: `q`, `type`, `limit`
- Answers: 200
- Name: `search.workspace`

## stories

### `GET /workspaces/{workspaceId}/stories`

The workspace's stories from the last 24 hours, oldest first.

- Answers: 200
- Name: `stories.list`

### `POST /workspaces/{workspaceId}/stories`

Post a few words as a story.

- Body: `body` (required), `tone` (required), `tryPath`, `tryLabel`
- Answers: 201
- Name: `stories.createText`

### `DELETE /workspaces/{workspaceId}/stories/{storyId}`

Take down a story you posted, or as an admin, any.

- Answers: 204
- Name: `stories.delete`

### `POST /workspaces/{workspaceId}/stories/photo`

Post a photo story; it is re-encoded and stripped of metadata, within the workspace’s storage limit.

- Body: the file itself, as `image/*`
- Answers: 201
- Name: `stories.createPhoto`

## stories-enabled

### `PUT /workspaces/{workspaceId}/stories-enabled`

Turn stories on or off for the workspace; owners only. Off hides the ones there are.

- Body: `enabled` (required)
- Answers: 200
- Name: `workspaces.setStoriesEnabled`

## suggestions

### `POST /workspaces/{workspaceId}/suggestions/feedback`

Record that a hint was used or set aside; nobody is named.

- Body: `kind` (required), `action` (required), `score`
- Answers: 204
- Name: `suggestions.feedback`

### `GET /workspaces/{workspaceId}/suggestions/stats`

How often this workspace's people used each kind of hint, beside the offline evaluation.

- Answers: 200
- Name: `suggestions.stats`

## two-factor-required

### `PUT /workspaces/{workspaceId}/two-factor-required`

Require two-factor sign-in of everyone in the workspace, or stop; turning it on needs it on your own account.

- Body: `required` (required)
- Answers: 200
- Name: `workspaces.setTwoFactorRequired`

## unsubscribe

### `POST /unsubscribe`

Use an unsubscribe link: email off for the kinds it names. Works once.

- Body: `token` (required)
- Answers: 200
- Name: `unsubscribe.confirm`

### `POST /unsubscribe/preview`

What an unsubscribe link would stop, without using it.

- Body: `token` (required)
- Answers: 200
- Name: `unsubscribe.preview`

## views

### `DELETE /workspaces/{workspaceId}/views/{viewId}`

Delete a saved view.

- Answers: 204
- Name: `savedViews.delete`

## webhooks

### `GET /workspaces/{workspaceId}/webhooks`

The workspace's outgoing webhooks, never their secrets. Admins only.

- Answers: 200
- Name: `webhooks.list`

### `POST /workspaces/{workspaceId}/webhooks`

Add an outgoing webhook for chosen events; its signing secret is in this answer and never again. Admins only.

- Body: `url` (required), `events` (required)
- Answers: 201
- Name: `webhooks.create`

### `DELETE /workspaces/{workspaceId}/webhooks/{webhookId}`

Remove a webhook and its delivery log. Admins only.

- Answers: 204
- Name: `webhooks.delete`

### `PATCH /workspaces/{workspaceId}/webhooks/{webhookId}`

Turn a webhook on or off, or change its events. Admins only.

- Body: `enabled`, `events`
- Answers: 200
- Name: `webhooks.update`

### `GET /workspaces/{workspaceId}/webhooks/{webhookId}/deliveries`

A webhook's latest deliveries, with each one's attempts and last answer. Admins only.

- Answers: 200
- Name: `webhooks.deliveries`

## workspaces

### `GET /workspaces`

The workspaces you are a member of, oldest first.

- Answers: 200
- Name: `workspaces.list`

### `POST /workspaces`

Make a workspace, with you as its owner and a #general channel.

- Body: `name` (required), `slug`
- Answers: 201
- Name: `workspaces.create`

### `DELETE /workspaces/{workspaceId}`

Delete a workspace and everything in it, confirmed with your password.

- Body: `password` (required)
- Answers: 204
- Name: `workspaces.delete`

### `GET /workspaces/{workspaceId}`

One workspace you are a member of.

- Answers: 200
- Name: `workspaces.get`

### `PATCH /workspaces/{workspaceId}`

Rename a workspace or change its theme.

- Body: `name`, `theme`
- Answers: 200
- Name: `workspaces.update`

### `POST /workspaces/demo`

Make a demo workspace with example issues, a document, a channel and a meeting, or return the one you already own.

- Body: `timeZone`
- Answers: 201
- Name: `workspaces.createDemo`

### `GET /workspaces/overview`

The home in one read: every workspace you are in, and the open issues assigned to you.

- Answers: 200
- Name: `workspaces.overview`
