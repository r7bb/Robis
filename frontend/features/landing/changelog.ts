/**
 * What has shipped, newest first.
 *
 * The one source for the landing page's "What's new" and the README's list
 * of the same name. `tests/changelog.test.ts` fails if an entry here is
 * missing from the README, so the two cannot drift apart. Every entry says
 * how it was checked, because a changelog that only announces is the part
 * of a project page nobody believes.
 */

export type Area = 'Product' | 'ML' | 'Security' | 'Site';

/**
 * A feature someone can use today, from the screen down to the database.
 *
 * Shown on the What's new page as where to find it and what each layer does.
 * Measurements, refusals and hardening have none: they are real work, but
 * there is nothing to click.
 */
type Feature = {
  /** What a person would call it. */
  name: string;
  /** Where to find it in the app. */
  where: string;
  /** What each layer does, screen first. */
  layers: readonly string[];
};

export type Entry = {
  date: string;
  area: Area;
  title: string;
  /**
   * One or two sentences for the lists: the README's Latest and
   * docs/WHATS_NEW.md, both written from here by `bun run docs:whats-new`.
   */
  brief: string;
  summary: string;
  /** How it is known to work: tests, measurements, or what was verified. */
  checked: string;
  /** Present only when the entry ships something usable end to end. */
  feature?: Feature;
};

export const CHANGELOG: readonly Entry[] = [
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'A picture a day, from public image libraries',
    brief:
      'An agent can post an openly licensed, credited picture to the feed each day from NASA, Wikimedia Commons or Openverse, and now and then a meme.',
    summary:
      'When an admin adds an agent, they can tick Posts a picture a day. Each day that agent posts a picture to the feed from one of three public image libraries: NASA’s image library, Wikimedia Commons’ picture of the day, or Openverse. Only pictures under a licence that allows reuse with credit are used (public domain, CC0, CC BY, CC BY-SA), and every post says what it is, who made it, its licence and where it came from. Every third day, when the picture is public domain or CC0, it comes as a meme: a work-friendly caption (about the work, never about a person) drawn across its foot, with a note that the caption was added. There is no language model and no paid service: the searches come from a fixed list, nothing from the workspace is sent anywhere, and pictures are fetched over HTTPS from those libraries’ own addresses only. The agent posts through the API like anyone, so its picture is re-encoded without metadata, counts toward storage, is in the audit trail, and can be taken down by an admin.',
    feature: {
      name: 'Picture of the day',
      where: 'People, Agents: Posts a picture a day; then on the Feed',
      layers: [
        'Screen: the option when adding an agent; the picture and its credit on the Feed',
        'Worker: a scripted job, hourly, posting each chosen workspace’s picture of the day, sometimes as a meme',
        'API: the agent posts through posts.createPhoto and posts.update with a token made for the run; agents may now upload images as members do',
      ],
    },
    checked:
      'Seven new tests with canned answers shaped like each library’s API, so no test touches the network: a picture posts once a day as its agent, with its licence, source and creator, re-encoded without metadata, and the run token is revoked; nothing where no agent was chosen or from a guest agent, and no library is asked when no workspace wants a picture; a licence that does not allow reuse is passed over for another library; only a public domain picture becomes a meme, credited as changed; and only HTTPS to the libraries’ own hosts is fetched, with a redirect anywhere else refused. The full suite, lint, typecheck, knip and docs:links. Not verified against the live libraries: this machine has no general internet access.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'A weekly check-in',
    brief:
      'Once a week the Feed asks what you are working on; your answer is a post, and your profile’s Working on line.',
    summary:
      'At the top of your Feed, once a week, a single question: What are you working on this week? Answer it and it goes on the feed as a check-in, and its first line becomes the Working on line on your profile in that workspace. Not this week puts the question away until Monday. Nobody is told who has answered and who has not, there are no streaks, and guests are not asked. The week runs Monday to Sunday, in UTC.',
    feature: {
      name: 'Weekly check-in',
      where: 'The top of the Feed, once a week',
      layers: [
        'Screen: the question, a Share button and Not this week',
        'API: posts.checkIn, and whether you have answered this week on feed.list (yours alone)',
        'Data: a check-in post, and the Working on line on your membership',
      ],
    },
    checked:
      'Three new tests: an answer is a post the team sees and sets your Working on line, and only you know you answered; a guest cannot check in; and the week starts on Monday at midnight UTC. The full suite, lint, typecheck, knip and docs:links. In headless Chrome on the rebuilt stack, with a throwaway account: the Feed asked, the answer appeared as a weekly check-in post, the question went away, and the profile’s Working on line became its first line.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'Swipe through Different shots',
    brief:
      'The Feed has a small stack of the day’s Different shots: swipe right to try one, left to set it aside, tap to read it all.',
    summary:
      'Under the stories on the Feed sits a stack of up to five Different shots, newest on top with the next two showing behind it. Swipe a card right, or press its button (Open the feed, Start a document and so on), and Robis takes you there; swipe it left, or press Not now, and it is set aside, with Undo for a few seconds (or Z); tap it, or press See more, to read all of it. Every swipe has a button, and with a button focused the arrow keys swipe too, so a mouse, a finger and a keyboard all work. With reduced motion set, cards fade rather than fly. What you set aside or tried is kept in your browser only, never sent anywhere, and the stack ends: “That’s all for today”.',
    feature: {
      name: 'Different shots stack',
      where: 'The Feed, under the stories',
      layers: [
        'Screen: a stack of up to five cards that follow a drag, with Not now, See more and Try it buttons and arrow keys',
        'Data: none new; the day’s shots are stories with a Try it, and what you set aside stays in your browser',
      ],
    },
    checked:
      'Two new tests for its rules: only shots show, newest first, without those set aside, five at most; and how far a card travels decides Try it, Not now, a tap or nothing. The full suite, lint, typecheck, knip and docs:links. In headless Chrome on the rebuilt stack, with a throwaway account and its own agent: a real drag to the left set a shot aside and offered Undo, which brought it back; a tap opened See more; the right arrow on a focused button went to the shot’s page; and setting the last one aside ended the stack with “That’s all for today”.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'Different shots',
    brief:
      'An agent can post an idea a day for the team to try, as a story with a Try it button that opens that part of Robis.',
    summary:
      'When an admin adds an agent, they can now tick Posts Different shots. Once a day that agent posts a short idea as a story, from a written list (share a desk photo on the feed, add a passkey, paste a screenshot into chat, start a document, and so on), each with a Try it button that opens the place it describes. Stories marked as a different shot show that above their words. There is no language model in it and nothing is sent anywhere. The agent works through the MCP server with a token made for that one run and revoked when it ends, so its post goes through the same permissions, retry ledger and audit trail as anyone’s, and the trail names it. A workspace gets at most one shot a day however often the job runs, none with stories turned off, and none from an agent that is only a guest. A Try it can only open a place in that workspace or the account page; anything else is refused.',
    feature: {
      name: 'Different shots',
      where: 'People, Agents: Posts Different shots; then in the stories strip',
      layers: [
        'Screen: a Try it button on a different shot in the story viewer, and the option when adding an agent',
        'API: stories.createText takes a Try it, checked to stay inside Robis; agents choose a shots agent',
        'Worker: a scripted job, hourly, posting each workspace’s idea of the day through the MCP tool post_shot',
      ],
    },
    checked:
      'Five new tests: the chosen agent posts the day’s idea with its Try it once a day, the next idea the next day, and its run tokens are revoked; nothing is posted without a chosen agent, with stories off, or by a guest agent; removing the agent stops its shots; a Try it is refused for another workspace, another site, a protocol-relative path, the sign-in page and a path that climbs out, and needs both its place and its words; and every written idea opens a place in Robis. The full suite, lint, typecheck, knip and docs:links. Not yet seen in a browser: the swipe stack of shots on the Feed is the next piece.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'A feed that ends',
    brief:
      'A Feed page for the team: posts of words or photos, three reactions and comments, pictures from rooms mixed in, and a clear "You’re all caught up" where it ends.',
    summary:
      'Feed in the sidebar opens the team’s stories along the top, a box to share something (words, a photo, or both; paste a screenshot and it becomes the photo), and then what has happened since you last looked, newest first: posts, and the pictures people posted in rooms, each with a way back to its room. Then it stops: “You’re all caught up”. Anything older is behind Show earlier and never loads on its own, so the feed is something you finish rather than something that keeps you. What you posted before a visit is never new to you. A post has three reactions, Celebrate, Helpful and Support, shown as the faces of who reacted rather than as a total, and comments behind a button. Your own posts are yours to edit or delete, and an admin can take any down, each asked once more. Guests can comment but not post. Photos are stored without their location, count toward the workspace’s storage, and go with their post or workspace; deleting your account takes your photo posts and reactions with it, while your words stay under “Deleted user”, like your messages. Built from research into feeds that respect people’s time, recorded with its sources in the platform plan.',
    feature: {
      name: 'Feed',
      where: 'Feed in the sidebar of any workspace',
      layers: [
        'Screen: stories along the top, a composer, post and picture cards with reactions and comments, a caught-up card and Show earlier',
        'API: feed.list and feed.seen, posts.create, createPhoto, update and delete, comments and reactions',
        'Data: posts, post_comments and post_reactions, and where each member last caught up',
      ],
    },
    checked:
      'Eleven new tests against the API and four for the page’s own rules: words and photos post inside the workspace only, guests answer but do not post, a photo is stripped and members only and captioned by its author alone, audited without words; pictures from rooms are mixed in newest first; the feed comes a page at a time and ends, and still follows on when the last item of a page has gone; each person’s caught-up point is their own; reactions are once per person and kind, shown as who, and can be taken back; comments list, count and are yours or an admin’s to take down; a post’s photo goes with it and with its workspace; and deleting an account takes its photo posts and reactions and keeps its words. The full suite, lint, typecheck and docs:links. In headless Chrome on the rebuilt stack, with a throwaway account: the Feed opened from the sidebar, a post and a pasted photo with a caption went up, a reaction and a comment showed, and coming back put them behind “You’re all caught up” until Show earlier. Security review: nothing critical or high; its points (exact paging, erasure, a limit on reactions) are fixed.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'Pictures in chat',
    brief:
      'Paste a screenshot into the message box, or choose or take a photo, and it posts to the room as a picture.',
    summary:
      'Under the message box there are now Photo and Camera. Photo chooses one or more pictures; Camera opens the phone’s own camera, or a live preview on a desktop; and pasting a screenshot straight into the box posts it, while pasted text stays text. Each picture is its own message, shown at a size that keeps the conversation readable and opening full size in a new tab. Pictures are stored without their location, count toward the workspace’s storage, are shown to members only, and go with their message, their room or their workspace. Posting one is recorded in the workspace’s history, as every upload is, though a text message is not. They also appear in their author’s profile, beside the images they added to issues.',
    feature: {
      name: 'Pictures in chat',
      where: 'Photo, Camera, or paste, under any room’s message box',
      layers: [
        'Screen: Photo and Camera under the message box, paste into it, and pictures in the conversation',
        'API: messages.createImage and the members-only picture route; messages carry their picture',
        'Data: a picture on its message, in the storage port, removed with the message, room or workspace',
      ],
    },
    checked:
      'Seven new tests against the API: a picture posts as its own message, stripped of metadata, served to members only and refused to a stranger, and is audited; a text message still has none; a replay stores one file and what is not an image is refused; a room in another workspace is a 404; pictures count toward storage and show on their author’s profile; and the file goes with its message (taken down by its author or an admin), its room and its workspace. The full suite, lint, typecheck and docs:links. In headless Chrome on the rebuilt stack, with a throwaway account: a screenshot pasted into the message box posted and showed in the room, text still sent as text, and a workspace tile on the home stayed put under the pointer. Security and code review: nothing critical or high; storage is now checked again with a picture’s real size, and pictures, covers and stories are served with a policy that lets nothing in them run.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'Profiles',
    brief:
      'Each person has a profile in each workspace: a cover, what they do there, what they are working on, what they have been doing, and the images they have shared.',
    summary:
      'Click a name on the People page or in the chat and you see that person as this team knows them: their picture (with its ring if they have a story), a cover photo or a band drawn from their id, their role, a title such as Design lead, and a Working on line. Below are their recent work (issues, comments, projects, documents, meetings, rooms and stories, only of the kinds your role may read) and a grid of the images they added to issues, each opening its issue. A profile never shows who joined or left, changed roles or settings, agents, saved views, taking down someone else’s words, or the audit trail’s own housekeeping; a kind of event added later stays off profiles until someone decides it belongs. Your own has Edit profile: a title, a Working on line and a cover, each optional and only for this workspace, since the same person can be a different person to each team. Covers are cropped wide, stored without their location, shown to members only, and removed with the membership, when someone leaves, is removed, is an agent taken out, deletes their account, or the workspace is deleted. Anyone outside the workspace, or asking after someone not in it, gets a not-found.',
    feature: {
      name: 'Profiles',
      where: 'A name on the People page or in the chat; Edit profile on your own',
      layers: [
        'Screen: the profile page with its cover, activity and shared grid, and an editor for your own',
        'API: profiles.get, update, setCover and removeCover, and the members-only cover image',
        'Data: a title, a working-on line and a cover on each membership; activity read from the audit trail through an allow-list',
      ],
    },
    checked:
      'Fourteen new tests against the API: a profile shows a member as the workspace knows them; it is a 404 outside the workspace and for someone not in it; your own edits are trimmed, cleared by nothing, refused when too long, and audited without their words; a title in one workspace is not in another; activity shows issues, comments, projects and stories but never a saved view, a role change or a take-down, and drops stories when they are off; a profile shows only that person’s events; the grid shows their images and not anyone else’s; a cover is cropped to 1500 by 500, stripped of metadata and refused to a stranger; a new cover replaces the old file, removing it removes the file, and removing one you do not have records nothing; a file that is not an image is refused; and the cover’s file goes when its owner leaves, is removed, is an agent taken out, or the workspace is deleted. One more for live refresh of open profiles. The full suite, lint, typecheck and docs:links. In headless Chrome on the rebuilt stack, with a throwaway account: the People page led to the profile, a title and working-on line were saved and shown, a cover chosen through the file input uploaded and showed, and a stranger’s id showed not found. Code and security reviews: nothing critical or high; their medium points (an agent’s cover left behind, a cover uploaded while leaving, unthrottled edits, take-downs on profiles) are fixed.',
  },
  {
    date: '2026-11-20',
    area: 'Product',
    title: 'Stories',
    brief:
      'Share a photo or a few words with your workspace for 24 hours: rings on faces, a full-screen viewer, and a photo taken with no signal posts itself once you are back.',
    summary:
      'Along the top of the chat there is now a strip of the team’s stories, and anyone with one has a ring round their picture there, in the chat and on the People page: in the workspace’s colour while there is something you have not seen, quiet once you have. A story is a photo (chosen, taken with the camera, or a screenshot pasted straight in) or a few words on one of five colours. Tap a ring and it plays full screen, six seconds each, then the next person: tap the right to go on, the left to go back, hold to pause, or use the arrow keys and Space; with reduced motion set, nothing plays on its own. Your own can be deleted and an admin can take anyone’s down, each asked once more first. Twenty-four hours after it was posted a story is gone from everyone at once, and a job then deletes it and its file. Photos are stored without their location. What you have seen is kept in your browser only, never sent anywhere. A photo posted with no signal is saved on the device, says so, and posts itself once, when the network is back. Guests see stories but do not post them, and an owner can turn stories off for the whole workspace from the People page, which hides them and refuses new ones until it is turned back on.',
    feature: {
      name: 'Stories',
      where: 'The top of the chat; rings on pictures; People, Stories for owners',
      layers: [
        'Screen: the strip, rings, a full-screen viewer and a composer for photos (choose, camera, paste) and words',
        'API: stories.list, createPhoto, createText and delete, the members-only image, and the owner’s switch',
        'Data: stories (expiring at 24 hours) and the workspace’s stories switch; photos in the storage port; a stories.expire job',
      ],
    },
    checked:
      'Twenty-eight new tests: sixteen against the API (metadata stripped; 404 outside the workspace and 403 for a guest posting; twenty showing at most; an offline replay storing one file and other bytes on its key refused; an expired story a 404 before the job, then row and file gone; take-downs by author and admin but not another member; the owner’s switch hiding, refusing and restoring; early refusals before a photo is read; images asked for again on each view; files gone with a member who leaves, an account and a workspace), three for the device’s queue (posted exactly once across a lost answer, let go when refused, never mistaken for an issue edit), seven for the strip and viewer order, and two for permissions and live events. The full suite, lint, typecheck and docs:links. In headless Chrome on the rebuilt stack, with a throwaway account: a words story posted from the composer and its ring showed unseen; a pasted screenshot posted with the network cut said it was saved on the device and posted once on reconnect, and not again on a second; the viewer played the words then the photo and the ring went quiet; and the owner’s switch removed the strip, the API answering 409, then brought it back. Code and security reviews: nothing critical or high; their medium points are fixed.',
  },
  {
    date: '2026-11-19',
    area: 'Security',
    title: 'Passkeys',
    brief:
      'Sign in with your phone, laptop or a security key instead of a password: no address to type, nothing a fake site can use.',
    summary:
      'Your account page has a Passkeys section: name one, give your password (and a code from your authenticator app, if two-factor is on, so a stolen session and password cannot add a way round the code), and your device asks for your fingerprint, face or PIN to make it. The sign-in page then has Sign in with a passkey, which asks for no address at all, as the passkey says whose it is. Every passkey must check who is holding the device as well as that someone is, so a passkey sign-in is two factors in itself and goes straight in, with no code after it. A passkey answers only for this site, so a look-alike page cannot borrow it. Robis keeps only its public half, the name you gave it, and when it was added and last used; the private half never leaves the device. Each challenge is answered once, a passkey whose own count of uses goes backwards is refused, an account holds up to ten, and removing one stops it at once. A workspace that requires two-factor still asks for the authenticator app: a passkey alone does not count there yet. Adding and removing them, and signing in with one, are in your account’s history, and “this was not me” from a new-browser email removes them all, as one may be the stranger’s.',
    feature: {
      name: 'Passkeys',
      where: 'Account, Passkeys; and Sign in with a passkey on the sign-in page',
      layers: [
        'Screen: a Passkeys section to add, list and remove them, and a button on the sign-in page',
        'API: passkeys.list, registerOptions, register and remove, and auth.passkeyOptions and passkeyLogin, checked with @simplewebauthn/server',
        'Data: passkeys (public key, name, use count, dates) and passkey_challenges, each spent once',
      ],
    },
    checked:
      'Sixteen new tests against a software authenticator with a real P-256 key and real signatures, so the verifier checks what a device would send: adding one needs the password and is listed without its key; with two-factor on it needs a right code too; one made without the user verified, or for another site, is refused; one account cannot finish on another’s challenge; an account stops at ten; a passkey lets its owner in with a session and the history says so; it goes straight in with two-factor on; each challenge is answered once; a sign-in without the user verified, from another site, or with its count gone back is refused; an unknown passkey, one naming another account or none, and an answer after its challenge ran out are refused; a removed passkey stops working and another account cannot remove it; and “this was not me” removes them all. The full suite, lint, typecheck and smoke:stack, and in headless Chrome with a virtual authenticator: a passkey was added from the account page, the person signed out, and Sign in with a passkey let them back in.',
  },
  {
    date: '2026-11-19',
    area: 'Security',
    title: 'An email when you sign in from a new browser',
    brief:
      'A sign-in from a browser your account has not used mails you, with a link that signs you out everywhere if it was not you.',
    summary:
      'Each browser you sign in from keeps a random cookie of its own, kept by Robis only as a hash. Signing in from one your account has not used, when it has used others, sends you an email saying which browser and when, in UTC. If it was you there is nothing to do. If not, its link opens a page with one button, Sign out everywhere: every session ends, the stranger’s with the rest, every browser is forgotten, so the very next sign-in anywhere mails you again, and the page goes on to a new password, since whoever signed in knows the old one. Opening the link alone changes nothing, so a mail scanner that follows it does no harm. The link works once, for 7 days. The browser you signed up in, and accounts from before this, are never mailed about the browser they already use. A cookie value Robis never gave out is replaced rather than trusted, and at most three alerts are mailed an hour, however often a stranger signs in. Both the alert and the sign-out are in your account’s history.',
    feature: {
      name: 'New-browser alert',
      where: 'Your inbox after a sign-in from a new browser, and the page its link opens',
      layers: [
        'Screen: /not-me, which asks before it signs out everywhere, then points to a password reset',
        'API: every sign-in notes its browser; auth.notMe ends every session and forgets every browser',
        'Data: known_devices (a hash of the browser’s cookie and when it was last seen); a one-time not_me link',
      ],
    },
    checked:
      'Nine new tests: a browser already used mails nothing, and its cookie is httpOnly and kept; one new to the account mails its owner once, naming the browser and the time, with a link that works for 7 days, and the account history says so; a made-up device cookie counts as new and is replaced rather than trusted; at most three alerts are mailed an hour; browsers not seen for over a year are removed; the link ends every session, the owner’s and the stranger’s, works once, and makes every browser new again, so the very next sign-in, even from the browser that was known, mails once; an unknown link is refused the same as a spent one; the browser names read for Chrome, Firefox and Safari, and say so when they cannot; and /not-me, like the other pages carrying a token, sends no referrer and is never cached. The full suite, lint, typecheck and smoke:stack, and in headless Chrome on the rebuilt stack: signing in from a second browser mailed the alert, and its link signed out everywhere.',
  },
  {
    date: '2026-11-19',
    area: 'Security',
    title: 'Growing waits after wrong passwords',
    brief:
      'The fifth wrong password for an address from one place starts a 30 second wait there, and each one after doubles it, up to a quarter of an hour.',
    summary:
      'The first four wrong passwords for an address cost nothing. The fifth from one place starts a 30 second wait before the next try from there, and each one after doubles it, up to 15 minutes, and a try made during the wait is refused without the password being checked at all, right or wrong. Trying a long list of likely passwords on one account then takes years rather than hours, at about a hundred tries a day, while the account’s owner, signing in from somewhere else, is not held up by it. An IPv6 address counts by its /64, the block one home or server is usually given, so moving to a fresh address for each guess gains nothing. Guesses spread over many machines meet a looser cap: past a hundred wrong passwords for one address in an hour, every try for it waits for the hour to turn. Someone with that many machines could keep an address waiting that way; a password reset lets its owner straight back in. Each try is counted before its password is checked, so a burst sent all at once cannot slip in before the first is counted. The counts are kept for the address as typed, whether or not an account has it, so a wait says nothing about who is registered. Signing in with the right password starts the counts again, and so does a password reset, since the mailed link proves the address. The sign-in page says how long to wait, and that a reset is the way round it.',
    feature: {
      name: 'Sign-in waits',
      where: 'The sign-in page, after several wrong passwords for one address',
      layers: [
        'Screen: the sign-in form says how long to wait, and that a password reset is the way round it',
        'API: auth.login refuses with 429 and Retry-After during a wait; auth.resetPassword clears it',
        'Data: none stored; counts are kept in the API’s memory, capped, as the request limits are',
      ],
    },
    checked:
      'Thirteen new tests: no wait for the first four, then 30 seconds at the fifth, doubling and never past 15 minutes; a wait runs from the last failure and is the same however the address is typed; wrong passwords from one place do not hold up the owner from another; past the hourly cap from many places, every place waits, and the cap starts afresh each hour so it never goes stale; IPv6 addresses in one /64 count as one place; failures are forgotten after an hour, the count starting again; after five wrong passwords the right one is refused too, with the wait and Retry-After; an address with no account waits just the same; ten tries sent at once give five refusals of the password and five waits; the right password before the wait starts the count again; one address waiting does not hold up another; and a password reset clears the wait. The full suite, lint, typecheck and smoke:stack on the rebuilt stack.',
  },
  {
    date: '2026-11-19',
    area: 'Security',
    title: 'Workspaces that require two-factor',
    brief:
      'An admin can require two-factor sign-in of everyone in a workspace; a member without it is told why, and how to turn it on.',
    summary:
      'A workspace’s People page now has a switch for admins: require two-factor sign-in. Turning it on needs two-factor on the admin’s own account first, so nobody turns it on and finds themselves outside. Once on, a member without two-factor is refused at every part of the workspace and on its live feed, a tab already open included, and opening it shows why, with a button to their account page to turn it on; once they have, they are let in. Until then the home, the inbox and their meetings leave that workspace out, and no email or push is sent them from it. An owner or admin of such a workspace cannot turn their own two-factor off, so it never ends up asking for what nobody running it has. Someone outside the workspace still gets not found, never the reason. Agents, which act with tokens and never sign in, are not asked, and a member can still leave. Each change is in the workspace’s audit trail.',
    feature: {
      name: 'Require two-factor',
      where:
        'A workspace’s People page, for admins; members without it see the reason on opening it',
      layers: [
        'Screen: a switch on the People page, and a page saying why and linking to the account page',
        'API: workspaces.setTwoFactorRequired, and every workspace route and the live feed refuse a member without it',
        'Data: workspaces.require_two_factor; whether a person has two-factor comes with their session',
      ],
    },
    checked:
      'Twenty new tests: an admin without two-factor cannot turn it on and is told why; with it, it turns on and the workspace says so; a member without it is refused with a clear message on the workspace, its projects, issues and channels; once they turn it on they are let in; a stranger still gets 404; a member may still leave; an agent with its token is not asked; the home, the inbox and my meetings show nothing of the workspace to the member; no mail or push is due them from it while the owner’s is, and mail already waiting for the digest is not sent either; an owner cannot turn their own off while it is required; turned off again they are let back in, and both changes are audited; a member who is not an admin may not change it; your account knows whether you have it; and the live feed refuses a member without it, and cuts off one already open, telling it why and closing it, as it now does for a member removed, while a feed still allowed is left alone. In headless Chrome on the rebuilt stack: an admin turned the switch on, and a member without two-factor opening the workspace saw the reason and the way to fix it.',
  },
  {
    date: '2026-11-19',
    area: 'Security',
    title: 'Two-factor sign-in',
    brief:
      'Turn on two-factor sign-in from your account page: after your password, Robis asks for a code from an authenticator app, or one of ten recovery codes.',
    summary:
      'Your account page can now turn on two-factor sign-in. Give your password, scan the QR code with an authenticator app (or type its key by hand), and type the first code it shows. You get ten recovery codes, shown once, for when the phone is lost. From then on, signing in asks for your password and then a code: each code works once, within its thirty seconds and one either side for a clock a little out, and each recovery code works once. Five wrong codes and the sign-in starts again from the password, a new sign-in replaces a half-done one, ten wrong codes in fifteen minutes make the account wait a few minutes wherever they come from, and changing or resetting the password ends any half-done sign-in. Making new recovery codes or turning it off asks for your password and a code, so a session left open on a borrowed computer cannot undo it. Each step is in your sign-in history. The authenticator secret is sealed with a key the server keeps outside the database, so a copy of the database alone does not give it away; recovery codes are kept only as hashes.',
    feature: {
      name: 'Two-factor sign-in',
      where: 'Your account page, under Two-factor sign-in; then the sign-in page asks for a code',
      layers: [
        'Screen: set-up with a QR code, recovery codes shown once, and a code step after the password',
        'API: twoFactor.state, setup, enable, recoveryCodes and disable, and auth.loginTwoFactor',
        'Data: two_factor (the sealed secret and the last step used), recovery_codes (hashes), sign_in_challenges (hashed, five minutes, five tries)',
      ],
    },
    checked:
      'Twenty-nine new tests. Twelve on the parts: the codes match the RFC 4226 and RFC 6238 test values, a code is taken one step either side of now and no further, only six digits count, a sealed secret opens only with its key and account and not once altered, and recovery codes are ten distinct, read loosely and refused when they are not codes. Sixteen against the API: set-up needs the password and gives a key and an address naming the username; a wrong first code turns nothing on; the password alone gives a challenge and no session; a code works once within its window and not outside it; each recovery code works once; five wrong codes end the challenge; a made-up challenge is refused; an account without it signs in as before; new codes need the password and a code and replace the old; turning it off needs both; each is in the account’s history; a new sign-in replaces the half-done one; ten wrong codes make the account wait even with the right code; and a changed password ends a half-done sign-in. One on the settings: a production API refuses the local stack’s key. A security review found no way in on a password alone; its high point, guessing codes with the password known, was answered by the per-account wait, one challenge at a time and each try counted before the code is checked. In headless Chrome on the rebuilt stack: a new account turned it on from the account page by its QR code’s key, kept ten recovery codes, signed out, was asked for a code after its password, and signed in with the next code.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Undo an agent’s change',
    brief:
      'The agents page lists what each agent changed, in plain words, with Undo while nobody has changed it since.',
    summary:
      'Admins now see what the workspace’s agents changed, newest first, each as a sentence: “Triage bot set the priority on REL-4 from none to high”, “Activity bot commented on REL-9”, linked to the issue. While a change is as the agent left it, Undo puts it back: a field returns to what it was, and a comment the agent wrote is removed. It goes through the same paths a person’s own edit takes, so the audit trail records it under the admin who pressed it, and the change counts as reverted in the agent’s record. Once someone has changed the thing since, Undo is not offered and is refused, so it never overwrites a person’s later work; a new issue an agent made is removed from its own page instead.',
    feature: {
      name: 'Agent undo',
      where: 'A workspace’s agents page, under What they changed',
      layers: [
        'Screen: each change as a sentence, linked to its issue, with Undo or why not',
        'API: agents.changes and agents.undoChange, for admins, through the idempotency ledger',
        'Data: no change; the values before and after an agent’s change were already kept',
      ],
    },
    checked:
      'Fourteen new tests. Ten against the API: a change listed with its issue, values and Undo on offer; a parent put back refused when it would make the tree go round; a change from another workspace not found; a field put back and then shown as undone; a second undo refused; never over a person’s later change; a comment the agent wrote removed; an issue the agent made left to its page; the undo in the audit trail under the person; a member who is not an admin refused and a stranger answered 404. Four on the wording. In headless Chrome on the rebuilt stack the agents page listed the triage agent’s comments with Undo and its status changes as changed since, and one Undo took that change off the list of undoable ones.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Warmer greys',
    brief:
      'The default Midnight theme moves from a blue slate to softer, warmer greys, so the work reads first.',
    summary:
      'Midnight, the theme a workspace starts with, now uses softer and warmer neutrals in place of its blue-tinted slate: the surfaces, borders and every grey of text. The accent is unchanged, and so are the other five themes. Everything stays well above the readability floor: body text at over 14 to 1 against its background, secondary text over 7 to 1 and the faintest over 5 to 1.',
    checked:
      'The theme suite’s contrast checks pass for every theme, and the faintest grey measures 5.81 to 1 on the page and 5.43 to 1 on a panel. Checked by eye in headless Chrome on the rebuilt stack, on the board, the chat and the inbox.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Priority and Other in the inbox',
    brief:
      'The inbox opens on Priority, what asks something of you, with everything else under Other, each with its unread count.',
    summary:
      'The inbox now has two tabs. Priority holds what asks something of you: where you were mentioned, an issue given to you, an invitation, and a change to a meeting you are in. Other holds what is good to know: comments on your issues and suggestions. It opens on Priority, each tab shows how many are unread, the arrow keys move between them, and Mark all read still clears both. A new kind of notification lands in Other until it is given a place, so nothing new jumps the queue.',
    checked:
      'Four new tests: the four kinds that ask something of you are Priority; comments, suggestions and any kind not yet named are Other; every kind with a setting lands in a tab; and the split keeps the order and counts each tab’s unread. In headless Chrome on the rebuilt stack, Alex’s inbox opened on Priority with his two mentions and two issues given to him, and Other showed the rest.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Today on the home',
    brief:
      'The home after signing in opens on Today: the issues assigned to you, where you were mentioned, and today’s meetings across every workspace.',
    summary:
      'The first thing after signing in is now your day. Under the greeting, three cards side by side: the open issues assigned to you, where you were mentioned (newest first, unread marked, and opening one marks it read), and today’s meetings in every workspace you are in, soonest first, with the time, the workspace, how long it is and your answer. A meeting’s Join link appears ten minutes before it starts and stays until it ends; meetings already over drop off, and today is the day where you are. The live feed becomes one line above the cards with the newest thing to happen, still live, and the ones before it under Earlier. It all still fits on one screen on a laptop or larger.',
    feature: {
      name: 'Today',
      where: 'The home after signing in, under the greeting',
      layers: [
        'Screen: Assigned to you, Mentions and Today’s meetings cards, and a one-line live strip',
        'API: meetings.mine, your meetings in a window of at most two days across the workspaces you are in',
        'Data: no change; meetings you are invited to or organise, left out once called off or once you leave the workspace',
      ],
    },
    checked:
      'Nine new tests. Six against the API: the meetings you are in from every workspace, soonest first, with the workspace and your answer; the organiser’s own, already yes; one under way counted, one outside the window or called off not; nothing from a workspace you have left; a window backwards, longer than two days or not a date refused; and 401 when signed out. Three on the day itself: midnight to midnight where the browser is, across a month and a year end, and a meeting later, soon in its last ten minutes, then under way until it ends. In headless Chrome on the rebuilt stack: the home measured one screen at 1440 by 900 and 1280 by 800, Today’s meetings showed two meetings with Join on the one about to start, and Alex’s mentions showed two unread.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Focus mode',
    brief:
      'Press the backslash key, or Focus in the top bar, to put the side panels away and leave only the board.',
    summary:
      'Focus mode puts the left rail and the chat away, so the board, or whatever page is in the middle, has the whole width. The backslash key turns it on and off from anywhere in a workspace, except while typing or with a dialog open; so do the Focus button in the top bar and Focus mode in the command palette. It is remembered on the device. The chat is put away rather than shut: Chat in the top bar, Discuss on an issue or a room opened from the palette brings everything back. On a phone, Menu still opens the left side.',
    checked:
      'Three new tests: only the backslash with nothing held turns it, the palette names it for the way it will go with its key, and the palette finds it by focus, hide sidebar or zen. In headless Chrome on the rebuilt stack: backslash hid the rail and the chat, a reload kept them hidden, backslash again brought both back, a backslash typed into the new issue field was just typed, the Focus button turned it on, and Chat left focus mode and showed the chat. The keyboard-only board test passed with the shared key check.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Discuss an issue in chat',
    brief:
      'Discuss on an issue starts a chat message about it, issue keys in chat open the issue, and each issue lists where it was talked about.',
    summary:
      'An issue and the chat are now joined by its key. Discuss, at the top of the peek and beside In chat on the issue, opens the chat with the issue’s key already in the message box, ready to finish and send. Any issue key written in a message, such as REL-4, becomes a link that opens that issue over its board; only the workspace’s own project keys count, so other words with a hyphen and a number stay plain text, and a key whose issue has gone is shown struck through. Each issue lists the newest ten messages that name it, with who wrote them, in which room and when, and choosing one opens that room. Nothing new is stored: a message names an issue simply by its key, so messages written before this count too.',
    feature: {
      name: 'Discuss in chat',
      where: 'Discuss at the top of an issue’s peek; In chat on every issue; issue keys in chat',
      layers: [
        'Screen: a Discuss button, an In chat list on the issue, and issue keys in messages as links',
        'API: issues.discussion (messages naming the key, behind the right to read rooms) and issues.byKey',
        'Data: no change; a message is matched by the key as a whole word, newest first, within the workspace',
      ],
    },
    checked:
      'Sixteen new tests. Nine against the API: messages naming the key found newest first with their rooms; a key written with leading zeros counted as the same; a longer key or a key inside a word not matched; another workspace’s rooms never searched; a stranger and an unknown issue answered 404; a long message cut to a preview; a key found in any case; an unknown or malformed key answered 404; a guest may look one up and a stranger may not. Seven on reading keys from text: only the workspace’s own project keys, whole words only, several to a message, leading zeros. In headless Chrome on the rebuilt stack: Discuss put REL-13 in the message box with the cursor ready; the message sent showed REL-13 as a link; the issue listed it under In chat with its room; and the key in chat opened the issue over its board.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Issue peek',
    brief:
      'Open an issue over the board without leaving it: click a card or press Enter, and Escape or Back takes you straight back.',
    summary:
      'Clicking a card’s title, or pressing Enter on a card, opens the issue in a sheet over the right of the board, with everything its own page has: the fields, labels, description, sub-issues, images and comments. The board stays where it was beside it, so choosing another card shows that one instead. The issue is in the address, so a peek is a link, a reload keeps it open and Back closes it. Escape or the close button shuts it and puts focus back on the card; Escape inside a confirmation or a picture closes only that. A comment not yet sent or a description being edited is asked about before the peek moves on. An issue deleted by someone else closes its peek. Open as page, or a Cmd or Ctrl click, still opens the issue on its own page, which shares the same parts.',
    feature: {
      name: 'Issue peek',
      where: 'Any board: click a card, or focus one and press Enter',
      layers: [
        'Screen: a sheet over the board with the issue’s whole detail, shared with its page',
        'Client: the issue in the address as ?issue=, live changes through the frame’s one connection',
        'Server: no API or data change',
      ],
    },
    checked:
      'The keyboard-only board test gained two checks (Enter on a card opens it over the board; Escape closes it with focus back on the card) and passed with all the rest. In headless Chrome on the rebuilt stack: a click peeked without leaving the board; another card switched it; Back went to the first, and again closed it; an unsent comment was asked about before switching, and saying no stayed; Escape in the delete confirmation left the peek open. A code review approved; its Escape, unsaved writing and deleted-elsewhere points fixed.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'The home on one screen',
    brief:
      'The home after signing in now fits on one screen on a laptop or larger, with no scrolling: the greeting, what needs you, the live feed and your workspaces.',
    summary:
      'On a screen at least 1024 pixels wide and 680 tall, the home after signing in is one screen with no page scroll. The greeting and the two-week activity chart take less height, what needs you and the live feed share the space under them and scroll inside their own cards, and your workspaces sit in one row along the bottom, scrolling sideways when there are many. A workspace tile shows its storage when the pointer is over it or it has focus. Smaller screens and phones scroll as a normal page, as everything would not fit.',
    checked:
      'In headless Chrome on the rebuilt stack, the page measured exactly the window’s height at 1440 by 900, 1280 by 800 and 1024 by 700, with all five issues that need you showing at 1280 by 800. The browser smoke test passed. Lint and typecheck clean.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'Quieter cards',
    brief:
      'Board cards drop their status menu and show a label dot, the due date and the assignee’s face, with Move and Delete appearing on hover.',
    summary:
      'Cards on the board say less, so the board reads at a glance. The status menu on every card is gone: a card changes column by dragging, by its Move button, or by the 1 to 4 keys. Labels show as a coloured dot each and the assignee as their face, on one line of the same height on every card, so nothing moves as the pointer passes; the names are in the dots’ and the face’s tooltips, read aloud to screen readers, and written out on the issue itself. Move and Delete appear when the pointer is over a card or it has focus, and always on a touch screen, where there is no hover.',
    checked:
      'In headless Chrome on the rebuilt stack, cards showed the key, title, priority, a dot per label and the assignee’s face, and Move and Delete appeared on hover. The keyboard-only board test (41 checks) passed, now reading a card’s column from the card rather than from its menu. Lint and typecheck clean.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'One place for each thing',
    brief:
      'Chat moves to the right of the board, and everything in a workspace now shows in one place only: boards and docs on the left, rooms and people at the top of the chat.',
    summary:
      'The workspace is now three parts, with nothing listed twice. On the left, quieter than the board: the boards with their open counts, the docs, and links to meetings, activity and people, each a page in the middle. Boards and docs are made from a + beside their heading. In the middle, the board or page. On the right, the chat: the open room’s name at its top opens the list of rooms and a field for a new one, and the faces beside it open everyone in the workspace, with the way to invitations, roles and agents. The tabbed panel on the right is gone, and so are the rooms and the team from the left. Drag the chat’s left edge, or use the arrow keys on it, to make it wider or narrower; the × or Ctrl ` hides it, and a Chat button in the top bar brings it back. On a phone the left side opens from Menu and the chat over the board, each closing on Escape and handing focus back to the button that opened it. A board is deleted from beside its name.',
    feature: {
      name: 'Calmer workspace frame',
      where: 'Any workspace: boards and docs on the left, chat on the right',
      layers: [
        'Screen: a left rail of boards and docs, a chat panel with a room picker and the team, and pages for meetings, activity and people',
        'Client: chat width and open state kept on the device, and one overlay behaviour for the phone menu and the chat',
        'Server: no API or data change',
      ],
    },
    checked:
      'Unit tests for the chat’s width limits and its shortcut, and for which board a workspace opens on. Full suite, lint, typecheck, knip and the link check pass. A code review and a Web Interface Guidelines audit; their points fixed, among them focus on closing, Escape and a kept Tab order in the phone overlays, a failed create that now keeps its field open with the reason, the saved chat choice no longer changed by a visit on a small window, and the board no longer jumping when the chat appears. In headless Chrome on the rebuilt stack: the board sat in the middle with the chat to its right at 1440 and 1280 pixels; rooms were listed only in the picker; Escape closed the room list and left the chat open; Meetings, Activity and People opened in the middle with the chat still beside them; on a phone the chat started closed, the menu took focus, kept Tab inside and gave focus back to Menu on Escape, the chat opened as a dialog and closed on Escape with focus back on Chat, and nothing scrolled sideways. The keyboard-only board test and the browser smoke test passed.',
  },
  {
    date: '2026-11-19',
    area: 'Product',
    title: 'The board at the centre',
    brief:
      'A workspace now opens on its board, with chat docked underneath like a terminal that you can resize, hide and bring back with Ctrl `.',
    summary:
      'Going into a workspace now opens a board: the one you last had open there, or the first project’s. The boards are listed at the top of the left rail, above the channels and the team, and moving between them keeps everything else in place. Chat sits under the board like a code editor’s terminal: a bar with the rooms that is always there, and the open room above it. Drag its top edge, or use the arrow keys on it, to make it taller or shorter; Hide folds it down to the bar, and Ctrl ` opens it with the cursor in the message box, or closes it. Its size and whether it is open are remembered on the device. The side panel of projects, docs, meetings, the team and activity opens by itself on wide screens and from the Panel button on any other, so the board keeps its four columns on a laptop. The board and the chat share one live connection. On a phone the boards and rooms become strips. Also fixed: in the Activity tab, an agent’s name and its badge left the words so narrow that they ran under the time, and an agent’s comment had its time out of line with everyone else’s.',
    feature: {
      name: 'Board-centred workspace',
      where: 'Any workspace: the board in the middle, chat docked below, boards on the left',
      layers: [
        'Screen: one frame for the workspace and its boards, a chat dock with a resizable edge, and a Panel button',
        'Client: one realtime connection shared by the board and the chat; dock size and the last board kept on the device',
        'Server: no API or data change',
      ],
    },
    checked:
      'Five new tests: the dock is never shorter than a few lines nor taller than most of the window, opens only on Ctrl and the backquote key, and a workspace opens on the board last open while it exists, else the first project not archived, else none. In headless Chrome on the rebuilt stack: Engineering opened on its Web App board with chat below, Ctrl ` hid the chat and brought it back with the cursor in the message box, choosing Backend kept the chat open, the board showed four columns at 1280 pixels wide with the panel closed, the Panel button opened it with a tab strip that does not scroll, Activity rows showed the agent’s name, badge and time on one line and what was done below, comment times lined up, and a phone showed no sideways scroll. The keyboard-only board test (41 checks) and the browser smoke test passed against the new layout.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Push notifications',
    brief:
      'Turn on push for a device from your account page, and get a prompt to open Robis when something new arrives, with nothing about it on the lock screen.',
    summary:
      'Notifications can now reach a phone or a computer as a push, following the same switches as the app and email, which gain a Push column. Turn it on for each device from your account page; the browser asks first. A push says only that something new is waiting, never what, who or where: the server sends it empty, so a lock screen and the push service in between learn nothing but that it happened. A second push replaces the first rather than piling up, and tapping it opens Robis. Signing out stops pushes to that browser, an account keeps at most ten devices, and a device the push service has let go is forgotten. Pushes are sent only to the browsers’ own push services, never to any other address. A server without push keys offers no push at all.',
    feature: {
      name: 'Web push',
      where: 'Your account page, under Notifications: a Push column and a switch for this device',
      layers: [
        'Screen: the device switch, a Push column, and the service worker’s fixed prompt',
        'API: push.key, pushSubscriptions.add and pushSubscriptions.remove',
        'Data: push_subscriptions (an endpoint per browser, no keys) and notifications.pushed_at; signed with VAPID, no push library',
      ],
    },
    checked:
      'Eighteen new tests: only the browsers’ own push services are taken, over https, with no look-alike host, address or port; the VAPID signature names the service, expires within a day and verifies with the public key, and halves of two different pairs are caught at start-up; a device is added once, removed only by its owner, moves to whoever subscribes it next, and an account keeps at most ten; a notification pings each device with no content at all and a Topic that folds waiting pings into one; a job run again after it went pings nobody twice; a device the service calls gone or malformed is forgotten, a refusal of the server’s own key keeps it and is not retried, and a service that is down is tried again with an error that never names the device; push off for a kind sends nothing; and a kind off everywhere makes nothing on any channel. In headless Chrome on the stack rebuilt with a throwaway key pair, the account page showed the Push column and the device switch, turning it on subscribed the browser, a push handed to the service worker showed only “Something new is waiting for you”, a second replaced the first, a reload kept it on, and signing out unsubscribed the browser.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Notifications by email',
    brief:
      'Get mentions by email as they happen and everything else in one summary a day, each with a link that stops it without signing in.',
    summary:
      'Notifications now reach you by email too, following the same switches on your account page, which gains an Email column. A mention is emailed as it happens. Everything else waits for one summary a day, sent from 08:00 UTC, listing each update with a link to it. Past ten mention emails in an hour, further mentions wait for the summary, so a busy thread cannot fill your inbox. Every email ends with a link that stops that kind of email without signing in: it opens a page saying what it will stop, and a button does it, so a mail scanner opening the link changes nothing. The link works once and lasts sixty days, and mail clients can offer it as their own unsubscribe button. Turning email off for a kind, even after something was made, stops it being sent. Mail goes only to an address you have confirmed. Names, titles and comments are put into the email as plain single lines, so nothing anyone writes can pass as part of the email itself.',
    feature: {
      name: 'Notification email',
      where:
        'Your inbox; the Email column on your account page; the link at the foot of each email',
      layers: [
        'Screen: an Email column in the notification settings, and a page that stops emails from a link',
        'API: unsubscribe.preview and unsubscribe.confirm, which need only the link’s token',
        'Data: notifications.email_due and emailed_at, email_digests (one a person a day) and unsubscribe_tokens (hashed, used once)',
      ],
    },
    checked:
      'Nineteen new tests: a mention is emailed at once with its issue, its words and a way to stop, but not with mentions off by email nor to an address never confirmed; past ten an hour, mentions wait for the summary; the summary waits for its hour, sends one email a day, carries later news the next day, never repeats a mention already mailed, and leaves out a kind turned off since; a digest job retried three times sends one email; an unsubscribe link says what it stops, works without signing in, turns off email alone, works once, and a made-up one does nothing; a kind turned off everywhere makes no inbox entry and no email at once or in the summary; and the email text keeps names, titles and comments on one line, without control or direction-changing characters, so none can forge the footer, with no line breaks reaching a header. In headless Chrome on the rebuilt stack, a mention reached the mail server with an unsubscribe link; signed out, the link’s page named Mentions, its button stopped them, the token left the address and a second visit said the link was spent; and the account showed mentions off by email and still on in the app.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Choose what you hear about',
    brief:
      'Turn each kind of notification on or off from your account, and hear when you are given an issue, someone comments on yours, or a meeting you are in moves.',
    summary:
      'Your account page now has a Notifications section listing every kind of notification, each with its own switch: mentions, issues given to you, comments on your issues, meeting changes and suggestions. Three of those are new. You now hear when someone else makes you an issue’s assignee, when anyone but you comments on an issue you filed or are assigned, and when a meeting you are in is moved, retitled or called off. Turning a kind off means it is never made, and a change is saved as you make it. Some things are told once rather than many times: an issue handed back and forth, or a meeting moved again and again, tells you once every ten minutes, and a save that changes nothing, or only the agenda, tells nobody. Someone mentioned in a comment on their own issue hears once, as the mention. A comment written by an agent (the triage agent writes one on every new issue) tells only the people it mentions, and agents are never told anything, having no inbox to read. Invitations to a workspace always reach you. Email and push come next, and will follow the same switches.',
    feature: {
      name: 'Notification settings',
      where: 'Your account page, under Notifications; new kinds show in the inbox',
      layers: [
        'Screen: a switch for each kind on the account page, and inbox entries for assignments, comments on your issues and meeting changes',
        'API: notificationSettings.get and notificationSettings.set; the inbox leaves out kinds turned off in the app',
        'Data: notification_settings (what each person turned off) and notifications.in_app; every notification goes through one gate that reads them',
      ],
    },
    checked:
      'Twenty-seven new tests: every kind starts on everywhere, one channel of one kind turns off and on again and is yours alone, and an unknown kind or channel is refused; being given an issue, or filed one already assigned, is a notification while taking it yourself is not, and a job run three times tells you once; a comment tells the issue’s filer and assignee but not its writer, once if they were mentioned, still when mentions are off, and not at all when an agent wrote it; moving or retitling a meeting tells its attendees but not the mover, cancelling does too, and a save that changes nothing or only the agenda tells nobody; an issue handed back and forth five times tells its assignee once; a kind off everywhere makes nothing, one off in the app stays out of the inbox and its count, and one off leaves the others alone; the inbox wording and links for each kind; and hidden notifications are pruned after 90 days. In headless Chrome on the rebuilt stack, the account page listed all five kinds, a switch turned off survived a reload, an issue given to another account reached its inbox as “gave you”, and the settings fit a phone with no sideways scroll.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'The board by keyboard',
    brief:
      'Run the whole board from the keyboard: single keys to file, move between, change, select and delete issues, and a list of them on the question mark key.',
    summary:
      'The board now answers to single keys. C files an issue, J and K move down and up a column, H and L across, and Enter opens the card you are on. 1 to 4 move it to Todo, In Progress, In Review or Done, M picks it up to move by arrow keys, X selects it for a change to several, and Delete or Backspace asks to delete it. F jumps to the filters, V to saved views (or the filters while there are none), the slash key opens the command palette, and the question mark shows every key on one page. Each key is offered only to someone who may use the button it stands for, so a guest can move around, open and filter but not change anything, and the help lists only what you can do. Keys rest while you type in a field and while a dialog is open, a held key does not repeat a change, a card picked up is put back if you move away from it, and Escape leaves the new issue field. A test in the build now does every board action with the keyboard alone.',
    feature: {
      name: 'Board keyboard shortcuts',
      where: 'Any board: press ? for the list, or Shortcuts beside Select issues',
      layers: [
        'Screen: cards that take focus, single-key shortcuts, and a help dialog of them',
        'API: no change; every key reaches the same endpoints as its button',
        'Data: no change; the shortcuts table shares the buttons’ permission checks',
      ],
    },
    checked:
      'Eleven new tests: which key means what in either case, none with Ctrl, Cmd or Alt held; moving between cards down, up and across, skipping empty columns and stopping at the ends; and the help lists a key for a role exactly when its button shows, a guest keeping only moving, opening, filtering and help. A new keyboard-only browser test, run in the build against the containers, signs up a fresh account and, with key events alone: files three issues; moves between them; moves one to In Progress and back to Todo by lifting it; selects two and moves both to Done in one change; filters by status; saves a view, picks it and deletes it; clears the filter from the command palette; deletes an issue after confirming; opens one and comes back with Ctrl K; and opens and closes the help. All 41 of its checks passed on the rebuilt stack, and the browser smoke test still passes.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'A command palette',
    brief:
      'Press Ctrl K or Cmd K anywhere in a workspace to find an issue, a document, a channel or a person, or to file an issue, open a board or change the open issue’s status.',
    summary:
      'Every workspace page now has a command palette. Press Ctrl K, or Cmd K on a Mac, or the shortcut shown in the search field, and start typing. It finds issues and documents by what they say, boards, channels and people by name, and lists what you can do from where you are: file a new issue, open a board, and on an issue’s page move it to another status. Arrows move through the list, Enter chooses, and Escape steps back or closes. A person leads to the issues assigned to them, on the board you are on or one you pick. Each action makes the same check as its button, so it is only offered to someone who may take it: a guest sees no New issue and no Change status. Search now matches the word you are still typing from its third letter, so “pipe” already finds “pipeline”, in the palette and the search box alike.',
    feature: {
      name: 'Command palette',
      where: 'Ctrl K or Cmd K on any workspace page, or the shortcut in the top bar’s search field',
      layers: [
        'Screen: a palette over the page with grouped results, second lists for choices, and the keys it answers to',
        'API: search.workspace matches the last word typed as the start of a word, and stops a search that runs long',
        'Data: no new tables; one table of actions to permissions is shared by the buttons and the palette',
      ],
    },
    checked:
      'Fifty-one new tests: what was typed picks and orders commands, every word must appear and accents do not matter; a command is shown to a role exactly when its button is, for every role and action, and a guest files, changes and deletes nothing; boards, channels, people and search results each lead to the right address; and search matches a word still being typed but not a finished one, an earlier one, one inside an open quote or an exclusion, or one under three letters, keeps an “or” meaning or, and drops a NUL rather than failing. In headless Chrome on the rebuilt stack, with the keyboard only: Ctrl K opened the palette with focus in its field; “authen” found the Safari authentication issue and Enter opened it; its status was changed to Done and back, once by typing and once through the list of statuses, with Escape stepping back out of that list first; a channel opened from the palette, and the first one again after another, the address left clean each time; New issue focused the board’s field, and from the workspace page opened a board ready to type; and the palette fits a phone with no sideways scroll.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Due dates and sub-issues',
    brief:
      'Give an issue a day it is due, shown on its card as it nears and once it passes, and break an issue into sub-issues in the same project.',
    summary:
      'An issue can now have a due day, set from its page. The card on the board and the issue page say how near it is: due today, tomorrow or in a few days, a date further off, or how many days overdue, louder as it nears. Done and cancelled work is never called overdue. A due day is a calendar day, not a moment, so it is the same day for everyone whatever their time zone. An issue can also be part of another in the same project: pick its parent from the issue page, or add sub-issues straight from the parent, which lists them with how many are done. An issue is never part of itself or of one of its own sub-issues, and two moves at once cannot make such a loop between them. A tree goes at most 50 deep. Deleting a parent leaves its sub-issues standing on their own, and an agent’s changes to a due day or a parent are judged later like its other edits.',
    feature: {
      name: 'Due dates and sub-issues',
      where:
        'An issue’s page, under Due and Part of, and its Sub-issues section; due days show on board cards',
      layers: [
        'Screen: a due day field and a chip on cards, a parent picker, and a sub-issues list with a quick add',
        'API: dueOn and parentId on issues.create, issues.update and the list; issues.get adds the parent and sub-issues',
        'Data: issues.due_on (a date) and issues.parent_id (same project, never itself, cleared when the parent goes)',
      ],
    },
    checked:
      'Fifteen new tests: a due day is set, listed and cleared, and something that is not a day, or a year no calendar here uses, is refused; a sub-issue names its parent and the parent lists it; moving under another issue and setting free are audited; an issue is never its own parent nor its descendant’s child, and two opposite moves at once let exactly one through; a sub-issue stays in its parent’s project and workspace; a tree goes at most 50 deep; sub-issues stand alone when the parent is deleted; and due days read as today, tomorrow, in N days, a date, or overdue by N days, never overdue once done, on the viewer’s own calendar. In headless Chrome on the rebuilt stack a due day set to yesterday read “Overdue by 1 day” on the issue and its card, a sub-issue added from the parent was listed with “0 of 1 done” and named its parent on its own page, and the issue page fits a phone with no sideways scroll.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'A page of search results',
    brief:
      'Press Enter in the search box for every match on its own page, narrowed to issues, documents or comments, with the matched words marked.',
    summary:
      'Search now has a results page. Press Enter in the search box, or pick All results under its list, to see up to fifty matches instead of twenty, and narrow them to issues, documents or comments with the tabs above. The query and the tab live in the address, so a search can be sent as a link. Each result shows an excerpt with the matched words marked. Excerpts now come from the server as plain pieces of text with the matches flagged, rather than as text with tags in it, so what someone wrote is shown exactly as written: a literal “&amp;” in an issue no longer turns into “&”, and nothing in the text can pose as a match.',
    feature: {
      name: 'Search results',
      where: 'Press Enter in the workspace search box, or open /workspaces/<id>/search',
      layers: [
        'Screen: a results page with tabs for each kind, a live count, and marked excerpts; the search box links to it',
        'API: search.workspace takes a type and a limit, and returns excerpts as text pieces with the matches flagged',
        'Data: no new tables; the full-text query marks matches with its own delimiters',
      ],
    },
    checked:
      'Six new tests: an excerpt comes back as text pieces with only the matched word flagged; text with planted delimiters or tag-shaped words cannot fake a match and an “&amp;” comes back as written; results narrow to one kind and a page of more is allowed while an unknown kind or a limit past fifty is refused; and the links lead a document to itself and an issue or comment to its issue, with the query and kind carried in the address. The other nineteen search tests still pass. In headless Chrome on the rebuilt stack, Enter in the search box opened the page with 7 results for “export”, each match marked; the Comments tab narrowed it to 3; a query with no match said so; and the page fits a phone with no sideways scroll.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Change many issues at once',
    brief:
      'Pick cards on the board and move, prioritise, assign, label or delete them together; anything you may not change is left alone and named.',
    summary:
      'The board has a Select issues mode: tick cards, then move them to a column, set their priority or assignee, put a label on or take one off, or delete them, all in one go. Each issue is judged on its own. One you may not change, one that is gone, one already that way or one at the label limit is left alone, and the board says how many were left and why rather than failing the rest. Everything that does change is one transaction with one audit entry per issue, written by the same code as changing a single issue, and a retried request with the same key is not applied twice. An agent changes at most 25 issues at once and deletes one at a time, so its runs stay reviewable call by call. Changing many issues needs a connection; the board says so when there is none.',
    feature: {
      name: 'Bulk changes',
      where: 'A project’s board: Select issues, then the bar above the columns',
      layers: [
        'Screen: Select issues, a pick box on each synced card, and a bar of actions with a plain summary of what changed and what was left',
        'API: issues.bulk, judging each issue on its own and reporting the ones it skipped with a reason',
        'Data: no new tables; the same issue, label and audit writes as single changes',
      ],
    },
    checked:
      'Fourteen tests: a bulk status change moves every issue with one audit event each; a guest’s bulk change skips every issue as not theirs to change and changes none; another workspace’s issue and a malformed id are skipped as not found while the rest change; an issue already that way is reported as unchanged; a label goes on and comes off, and another workspace’s label is refused; a bulk delete is audited per issue and a replay with the same key does nothing twice; an empty list and more than a hundred ids are refused; assigning and unassigning work and an agent is refused as assignee; an issue named twice, in either case, counts once; an issue at the label limit is left alone; a guest naming an unknown label learns only that it may not; an agent records itself as delegate, may not delete in bulk and is held to 25; and the summary counts what was left by reason.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Board filters and saved views',
    brief:
      'Narrow the board by status, priority, assignee or label, share it as a link, and keep a filter by name for the whole workspace.',
    summary:
      'The board now has a filter bar: status, priority, assignee and label, each one narrowing what the board shows. The filter lives in the address, so a filtered board can be sent as a link and comes back after a reload; since every issue is already on the device, filtering works with no connection too. Members can name the current filter and keep it as a saved view, which everyone in the workspace then sees in a list above the board. A view may only name this workspace’s labels and people, names and filters are unique in a project, and making or deleting one is in the audit trail. The issue list in the API takes priority and label filters as well.',
    feature: {
      name: 'Board filters and saved views',
      where: 'A project’s board, above the columns',
      layers: [
        'Screen: a filter bar with four filters, Clear filters, a saved views list and Save view',
        'API: savedViews.list, savedViews.create and savedViews.delete, and priority and label filters on issues.list',
        'Data: saved_views (a name unique per project and the validated filter)',
      ],
    },
    checked:
      'Fourteen tests: the issue list narrows by priority, by label and by both; saved views keep a filter and list by name for a guest too; names are unique whatever their case, and two views cannot keep the same filter; an empty filter is not saved; a filter naming another workspace’s label or person, or a priority that does not exist, is refused; a guest may not make or delete a view; deleting is audited, works once, and another workspace gets a 404. The URL helpers read back what they write, drop invalid values, and never change the filter they are given. In headless Chrome on the rebuilt stack, filtering by priority narrowed 10 cards to 1 and put it in the address, the filter survived a reload, a saved view was picked from the list, the bar wrapped at phone width with no sideways scroll, and deleting the view went through the confirm dialog.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Labels on issues',
    brief:
      'Make labels in six fixed colours, put them on issues from the issue page, and see them as chips on the board.',
    summary:
      'A workspace can now have labels: a name, unique whatever its case, and one of six colours chosen so every label reads on every theme. Members make and delete them; anyone who may edit an issue sets its labels from the issue page, where a new label can be made in place. The board shows each card’s labels as chips. Deleting a label takes it off every issue. Each change is in the audit trail, and an issue can only carry its own workspace’s labels.',
    feature: {
      name: 'Labels',
      where: 'An issue’s page, under Labels; chips appear on the board',
      layers: [
        'Screen: Edit labels on the issue page, with a field to make one, and chips on board cards',
        'API: labels.list, labels.create, labels.delete and issues.setLabels, with each issue’s label ids on the list',
        'Data: labels (name unique per workspace, colour from a fixed palette) and issue_labels',
      ],
    },
    checked:
      'Six tests: labels are made with a palette colour and listed by name, an unknown colour is refused, names are unique whatever their case, a guest may not make one, an issue’s labels are set exactly and audited, another workspace’s label is refused, and deleting a label takes it off its issues. In headless Chrome on the rebuilt stack a label made from the issue page appeared as a chip on its card on the board.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'Cards move by dragging, or by keyboard',
    brief:
      'Drag a card within or between columns, or lift it with Space and move it with the arrow keys; it works offline like every other change.',
    summary:
      'Cards on the board can now be dragged to a new place in their column or to another column. From the keyboard, a card’s Move button lifts it with Space or Enter, the arrow keys carry it up, down and across, Space drops it and Escape puts it back, with each step read out. Every card has a position key that sorts between its neighbours, so moving one card writes only that card. A move is an ordinary edit and goes through the offline queue, so a card moved with no connection stays where it was put and lands there when the connection returns. Existing boards keep the order they had.',
    checked:
      'A test moves a card offline to the top, checks the queue holds it, reconnects, and finds the server and the board agree on the new place. Others check that a new issue goes to the top, a move changes that issue alone, a malformed position is refused, and where a dropped card lands between, above, below and beside a card made offline. The migration gives existing issues positions in their old order.',
  },
  {
    date: '2026-11-18',
    area: 'Product',
    title: 'A page of what the agents did',
    brief:
      'Admins see each agent’s latest runs call by call, how many of its changes people kept, edited or reverted, and how the hints fare in use.',
    summary:
      'Agents at work is a page for a workspace’s admins, reached from the agents list. It shows, per agent, how many of its changes people kept, edited or reverted once they were a week old, and how many are still too new to judge, as counts with a share beside them and never a share alone. Below are its latest runs: open one to see each call it made, which tool, whether it worked, was refused or failed, and how many milliseconds it took. Last, how often people used or set aside the composer’s hints, beside the duplicate finder’s offline evaluation and labelled as a different measurement. It works on a phone, where the counts scroll sideways in their own frame.',
    feature: {
      name: 'Agents at work',
      where:
        'A workspace’s side panel, under Team, then Agents, then See what they did (admins only)',
      layers: [
        'Screen: per-agent kept, edited, reverted and pending counts; latest runs that open to their steps; hint figures beside the offline evaluation',
        'API: agents.activity and suggestions.stats, for admins and owners only',
        'Data: agent_runs, agent_steps, agent_changes and suggestion_feedback, kept 90 days (feedback a year)',
      ],
    },
    checked:
      'Tests: the page’s answer gives the latest runs step by step and the per-agent counts after a person reverted an agent’s change, a stranger gets a 404, and an agent cannot add hint feedback. In headless Chrome on the rebuilt stack the page showed a triage run’s four calls with their outcomes and times, the agent’s separate call, and its pending changes, at desktop and phone widths with no sideways scroll. A security review led to the runs being read in three queries rather than one per run, and to agents being refused from the hint figures.',
  },
  {
    date: '2026-11-18',
    area: 'ML',
    title: 'The composer’s hints are measured in use',
    brief:
      'Using or setting aside a duplicate or priority hint is counted, without naming anyone, beside the offline evaluation it differs from.',
    summary:
      'The composer’s hints now have a Not this and a Not a duplicate button, and using a hint, by pressing Use or opening a suggested duplicate, is counted too. Each count records only the kind of hint, what was done with it and its score: nobody is named, because this measures the hints and not the people. An admin sees how often each kind was used or set aside, beside the duplicate finder’s offline evaluation (precision 0.79, 15 of 19 hints, on a labelled set), labelled as a different measurement: one is people at work, the other a set of pairs judged by hand. Priority suggestions have no offline evaluation to show beside theirs.',
    checked:
      'Six tests: feedback is recorded without a user, a stranger gets a 404 and a bad kind a 400, one person is limited to 60 a minute, the figures match a seeded set of 3 and 5 duplicate and 4 and 1 priority accepts and dismisses, the offline figures shown are the ones robis-ml’s README reports (a test reads it), and the figures are for admins only.',
  },
  {
    date: '2026-11-18',
    area: 'Security',
    title: 'Whether people kept what an agent did',
    brief:
      'Each change an agent makes is judged after seven days: kept, edited by a person, or reverted, from the values before and after.',
    summary:
      'The honest measure of an agent is what people did with its work. Each change an agent makes to an issue, and each issue or comment it adds, is stored with the value before and after. Seven days later the worker looks again: if the agent’s value is still there the change was kept, if the earlier value is back or the thing was deleted it was reverted, and anything else counts as edited. The audit trail could not answer this by itself, because it records which fields changed and not their values, so an undo and an edit look the same there. Runs, steps and judgements are kept for 90 days, and hint feedback for a year.',
    checked:
      'Eight tests, judged by the worker’s own database account: an agent’s status change that a person sets back shows as reverted; one left alone is kept and one changed again is edited; nothing is judged before seven days; an issue the agent filed and a person deleted is reverted; a comment an admin removed is reverted; a person’s own edits record nothing; and runs with their steps and old judgements are pruned after 90 days.',
  },
  {
    date: '2026-11-18',
    area: 'Security',
    title: 'Every call an agent makes is recorded',
    brief:
      'Each agent call in its workspace becomes a step of a run: the tool, whether it worked or was refused, and how long it took; the MCP server has metrics too.',
    summary:
      'The first part of watching agents. Every call an agent makes in its own workspace is recorded once it has been answered, as a step in a run: which tool made it, whether it succeeded, was refused or failed, its status and how long it took. Nothing it sent or wrote is stored. A triage run is exactly one run, because it works with a token made for that run; another agent’s calls are grouped by the run id its client sends, or else into runs that end after half an hour of quiet. The MCP server also counts its tool calls and times them for Prometheus, labelled only by tool and outcome. A page to read all this comes next.',
    checked:
      'Thirteen tests: a direct call is named by its route, a refusal is a denied step, a call into another workspace is not recorded there, a person’s call is not a step, tools are named through the MCP server, calls close together share a run and a quiet spell starts a new one, each triage run is its own, and a client’s run id cannot pass for a triage run. A database review led to grants for the worker, indexes for the prune and the run lookup, and fewer writes per call. On the rebuilt stack the smoke test’s agent calls appeared as steps with their tools and outcomes.',
  },
  {
    date: '2026-11-17',
    area: 'ML',
    title: 'An optional one-line summary on triage comments',
    brief:
      'With a provider key set and a workspace’s consent, the triage agent adds a one-line summary from a language model; without either, nothing is sent anywhere.',
    summary:
      'The triage agent can now begin its comment with a one-sentence summary of the issue, written by a small language model. It is off twice over: the server needs a provider key, and an admin must turn it on for the workspace when choosing the triage agent, because each new issue’s title and description are then sent to a paid third-party service. The setting says so where it is chosen. The issue text is passed to the model as quoted data, never as instructions, and what comes back is cut to one plain line, labelled as written by a language model and unchecked. A refusal, a timeout or an outage costs the summary, never the comment.',
    checked:
      'Eight tests, run with no key and no network: summaries are off unless chosen, the summarizer is never asked in a workspace that did not opt in even when one is configured, the summary line appears when it did, a failing summarizer still leaves the comment, removing the triage agent turns summaries off, and the provider port asks the small default model at low effort and returns one line, or nothing on a refusal or an error. A security review led to a cap of 200 summaries per workspace a day, a summary remembered per issue so a retried run does not pay twice, the issue text capped and escaped so it cannot close its quoting, errors logged by name only, and the line labelled as machine-written and unchecked; each has a test. Not checked here: a call to the real service, which needs a key this machine does not have.',
  },
  {
    date: '2026-11-17',
    area: 'Product',
    title: 'Agents are marked wherever they appear',
    brief:
      'An Agent mark beside every agent in the team list, comments, activity and an issue’s delegate; admins add agents and their tokens from the Team panel.',
    summary:
      'Anything an agent does now says so. Its name carries an Agent mark in the sidebar’s team list, the member list, on its comments and in the activity feed, and an issue an agent has worked on shows it as the delegate beside the person assigned, who is always a person: agents are not offered as assignees. Admins add agents from the Team panel, as a member or a guest, optionally as the workspace’s triage agent. A new token is shown once, with a button to copy it, and is kept nowhere afterwards; tokens can be revoked one by one after a second click, and removing an agent stops all of them.',
    feature: {
      name: 'Agents in a workspace',
      where: 'A workspace’s side panel, under Team, then Agents (admins only)',
      layers: [
        'Screen: an Agents list under the members, a form to add one, a token shown once with Copy, Revoke with a confirming second click',
        'API: agent routes for admins, and answers that carry who is an agent: member kind, comment author kind, activity actor kind, issue delegate',
        'Data: users.kind, agent_tokens kept as hashes, issues.delegate_id, workspaces.triage_agent_id',
      ],
    },
    checked:
      'A test checks that comments and activity entries made by an agent say so and that its placeholder address is never shown. In headless Chrome on the rebuilt stack, an admin added an agent with triage from the Team panel: the token appeared once with Copy, the agent appeared marked in the sidebar, the member list and the agents list, and its triage comment on a new issue carried the mark. The panel was checked against the web interface guidelines, which led to a confirming second click on Revoke and a progress label on Add.',
  },
  {
    date: '2026-11-17',
    area: 'ML',
    title: 'A triage agent that suggests and changes nothing',
    brief:
      'A workspace can choose a triage agent; on each new issue it comments likely duplicates and a priority with their scores, and leaves every field to people.',
    summary:
      'When an admin adds an agent, they can make it the workspace’s triage agent. From then on, each new issue gets a comment from it within a second or so: the issues it may duplicate with their similarity, and the priority the model suggests with its score, or how many triaged issues the model still needs before it will suggest one. It never sets the priority or anything else, and says so in the comment: it advises exactly as the composer does while a person writes. It has no model of its own and no language model. It works as any agent does, through the MCP server, with a token made for that one run, good for five minutes and revoked when the run ends, so the audit trail names it and its permissions are those of its role.',
    checked:
      'Fourteen tests: the comment’s wording for a suggestion, for a model still learning, with and without a summary line; a new issue is queued only in a workspace with a triage agent and not when the agent filed it; a run comments as the agent, leaves the priority alone and revokes its token; a job run twice comments once; a removed agent stops triaging. A security review led to narrower database rights for the worker, a trigger that makes revoking a token final, deletion of old run tokens, and titles kept to one line in the comment; each has a test. On the rebuilt stack, filing an issue produced the agent’s comment in about half a second, with the real model’s answer. What is left open is listed in the platform plan.',
  },
  {
    date: '2026-11-17',
    area: 'Product',
    title: 'Agents work through an MCP server',
    brief:
      'An agent connects at /mcp with its token and can search, read, file and update issues, and comment, as itself and no more.',
    summary:
      'Robis now speaks the Model Context Protocol, so an agent built on any MCP client can work in a workspace. It connects to /mcp with the workspace in the path and its token, and gets six tools: search, list projects, read an issue with its comments, file an issue, change one’s title, description or status, and comment. Priority and assignee are left to people. The server holds no authority of its own: every tool is a call to the API with the agent’s own token, so the API decides what is allowed and records what happened, exactly as for a person. Every write takes a key, and sending the same key again does not repeat it. It runs as its own small service with no database access and no secrets.',
    checked:
      'Thirteen tests drive it with the protocol’s own client: the tool list; filing, editing, commenting, reading and searching as the agent; a retried issue and comment with the same key happen once; a guest agent’s refused write carries the same status and code a guest person gets; another workspace is a 404; a revoked token is refused on the next call. A security review asked for unexpected errors to stop naming internal addresses, a 64 KB request cap, and refusing malformed tokens and browser pages early; each is done and tested. On the rebuilt stack, an agent commented through /mcp at the edge proxy, and its image holds neither the API’s web framework nor its image library. Its 92 packages are MIT, ISC or BSD licensed.',
  },
  {
    date: '2026-11-17',
    area: 'Security',
    title: 'Agents can join a workspace, on a short leash',
    brief:
      'Admins add an agent as a member or guest with a token shown once; it acts through the same permissions, retries and audit trail as anyone.',
    summary:
      'The first part of agents as teammates. An admin adds an agent to a workspace as a member or a guest, never higher, and gets a token for it, shown once and kept only as a hash. With the token the agent can do in that workspace what its role allows and nothing else: outside it, it is answered exactly as a stranger is, and it has no account to sign in to. Everything it does is recorded as done by an agent, and an issue it touches names it as the delegate while a person stays the assignee. Revoking a token stops it on the next call. Editing an issue and posting a comment now go through the retry ledger too, so a repeated call never posts twice. The MCP server and the triage agent that use this come next.',
    checked:
      'Tests written alongside the code, 29 in all: an agent outside its workspace gets the same 404 and body a stranger does, and a guest agent the same 403 a guest person does; a repeated issue, comment or edit happens once; a revoked token fails on the very next call while another keeps working; an agent cannot sign in, be invited elsewhere, be made an admin, be an assignee or leave on its own. A security review found the retry ledger would have kept new token secrets; those two answers now stay out of it, and a test checks no secret is stored. The stack and browser smoke tests pass on the rebuilt stack, and the full suite passes.',
  },
  {
    date: '2026-11-16',
    area: 'Site',
    title: 'A page that does not start says why',
    brief:
      'The browser check now reports how long each page took to start, and for one that never does, what it was waiting on.',
    summary:
      'About one CI run in five, the browser check finds the landing page has not started within 15 seconds over HTTPS, though the next page starts in under a second. This week’s scheduled run was one of them. It could not be made to happen here: ten fresh browsers started the page in about 0.15 seconds, still under 1.6 seconds with the processor slowed twenty times, and three full runs of the check over HTTPS passed. So the check now says how long each page took, and when one does not start, it records what the page threw, which requests failed or were blocked, which were still open, and which took longest. The next failure will name its cause instead of only reporting it.',
    checked:
      'Run over HTTPS against the production stack, every page reported its time (about 0.9 seconds each) and the check passed. With the app’s main script blocked on purpose, the report named the page’s state, its slowest requests and the blocked script. Not yet known: the cause of the CI failures, which waits on the next one.',
  },
  {
    date: '2026-11-02',
    area: 'Product',
    title: 'An edited issue keeps its assignee’s name',
    brief:
      'After an edit made on the board synced, the card lost the assignee’s name until the next full refresh; it keeps it now.',
    summary:
      'Changing an issue’s status or title on the board, online or off, goes through the sync queue. When the change reached the server, the board stored the server’s answer as the card, and that answer names the assignee by id only, so the card showed nobody until the board next refreshed in full. The card now keeps the name it had when the assignee is the same person. If someone reassigned the issue elsewhere in the meantime, the card shows no name, never the previous person’s, until the refresh brings the new one.',
    checked:
      'Three new tests, written to fail first: the name survives an edit once it syncs; it is cleared rather than kept wrong when the answer names a different assignee, and the next refresh brings the new name; and an issue created on the device has an empty assignee, not a missing one. The test stand-in for the server now answers exactly as the API does, which is why the old tests never saw this. The web app’s sync now uses the typed API contracts, so the compiler checks the answers’ shape. The sync tests, typecheck, lint and the unused code check pass.',
  },
  {
    date: '2026-10-31',
    area: 'Security',
    title: 'Base images are re-pinned on a schedule',
    brief:
      'Dependabot proposes new base image digests weekly and CI rebuilds and scans every Monday; the security upgrade step stays until a new base scans clean.',
    summary:
      'Each container starts from a base image pinned by digest. The pins were written in a form Dependabot cannot read, so nothing ever proposed a newer one, and a vulnerability published after the last push went unseen until the next. The pins are now plain lines Dependabot updates, it proposes new digests every week, and CI rebuilds and scans every image each Monday with or without a push. The plan was also to stop applying Debian’s security updates during the build and rely on re-pinning alone. That was not done: the newest Bun base image still has three critical findings with a fix, which only the update step removes.',
    checked:
      'A test fails if any image starts from a base that is not a literal name, version and digest, if Dependabot stops covering them, or if CI loses its schedule; against the files as they were, it failed on the pins and the schedule. The newest digests were looked up for both bases (the pins were current) and scanned with the same scanner and settings as CI: the Python base had no critical findings, the Bun base had three, all fixed by the update step. A security review of the change found that a push could cancel the weekly run and that cached layers could hide new fixes; the weekly run now has its own group and builds without the cache, and the test covers both. Dependabot’s first run proposed new Bun and Python versions as well as digests, including Python 3.15 where the tests run on 3.11; it is now limited to digests, and a test holds it there.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'Each topic is written in one place',
    brief:
      'Status, known gaps and what is not being built live in the roadmap alone; stale lines saying account events are not recorded are corrected.',
    summary:
      'Where Robis stands was written in four documents, and they had drifted: the app summary still listed storage quotas as missing weeks after they shipped, and the platform plan still said sign-ins were not recorded and that accounts could not be deleted. Now the roadmap holds status, the known gaps, what waits on legal review and what is deliberately not being built; the architecture notes hold the reasoning and the app summary the inventory, and both link to the roadmap. The roadmap also states the rule that keeps it so: when a feature lands, search the docs for anything still calling it missing.',
    checked:
      'A test refuses a status, gaps, legal review or not-doing section in any document but the roadmap; run against the documents as they were, it finds the four that were there. Each corrected line was checked against the code: the account trail’s event types, the account deletion test, and the storage drivers. Every relative link still resolves, and the full suite passes.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'What’s new is written from one list',
    brief:
      'The README’s Latest and docs/WHATS_NEW.md are generated from the site’s changelog, and CI refuses them out of date.',
    summary:
      'What has shipped was written three times: in the site’s changelog, in the README’s Latest, and in the What’s new document, each by hand, with a test checking only that the titles matched. Each entry now carries its own one-line brief, and one command writes both lists from the changelog, between markers, leaving the text around them alone. The 56 existing briefs were moved across word for word.',
    checked:
      'A test fails unless both files read exactly as the generator writes them, and another shows that adding an entry leaves both out of date until they are rewritten. The moved briefs were compared word by word with the old document: same words, same order, only the line breaks changed. The full suite, lint and the unused code check pass.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'Unused code is found, and refused',
    brief: 'Dead definitions removed; CI checks for unused files, exports and dependencies.',
    summary:
      'Eleven database relation definitions that no query used, a status helper, a request type and six response types were removed, and about twenty names that were only used inside their own file stopped being exported. A check for unused files, exports and dependencies now runs on every push, so dead code is caught when it appears rather than in a review months later.',
    checked:
      'The check (Knip, ISC licensed, pinned) reports nothing on the repository, and fails on a planted unused export; CI also runs it against a small sample with a known unused export and requires it to fail. Typecheck, lint and the full suite pass.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'Screenshots are kept once, as WebP',
    brief:
      'One copy of each at display size, written by the screenshot script; the web build no longer converts images.',
    summary:
      'Five screenshots were stored twice, once for the README and once for the landing page, and every one was a full-size PNG. Each is now kept once, as WebP at the widest any page shows it: the three the landing uses live with the site, and the README points at them. The still screenshots went from 7.1 MB to 1.2 MB. The screenshot script now writes WebP itself, so the web build no longer converts images, and the web app no longer depends on an image library at all.',
    checked:
      'A test fails if any committed image is not WebP, if two image files are identical, if any is wider than the landing shows it, or if the README, the docs or the landing refer to an image that is not committed. Another test confirms the web app declares no image library. The full suite, lint and typecheck pass, and the production build runs without the conversion step.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'The landing loads its heavy parts as you reach them',
    brief: 'The field and the live demo are separate downloads, fetched near the screen.',
    summary:
      'The moving field behind the landing and the live two-editor demo were part of the page’s first load, though the demo sits well below the fold. Each is now its own download, fetched after the page is usable and only once its spot comes within 200 pixels of the screen. The demo’s space is held at its real height while it loads, so nothing below it jumps. With reduced motion turned on, the field still draws one still frame and the demo still does not animate.',
    checked:
      'A test refuses any landing file that imports the field or the demo directly, so neither can slip back into the first load. In headless Chrome on the rebuilt stack, the field drew at the top, the demo was absent until scrolled near and then appeared, its held space measured the same 299 pixels as the demo itself, and the closing field drew at the bottom. The browser smoke test passed. Honestly: with the processor slowed six times, the page became interactive in about the same time as before, so the gain is in what the first load carries, not a faster measured start.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'The benchmark counts what a write costs afterwards',
    brief: '14 follow-up reads per write across 50 open boards; figures refreshed.',
    summary:
      'The load harness measured how fast a write reached every open client, but not what happened next: each open board then reads its issues again. Now each simulated client acts as an open board, scoped to its project and coalescing as the web app does, and the report counts the follow-up reads each write causes and times them. Across 50 open boards a write costs 14 reads, where it would cost 50 without coalescing. The harness had also stopped measuring anything since pictures became required: its test accounts had none, so every request was refused. They have one now, and the published figures are refreshed from three new runs.',
    checked:
      'Three default runs: zero errors, 29,500 of 29,500 receipts delivered, 14.0 follow-up reads per write, a follow-up read at 24.4 ms p50, and about 3,600 requests a second, which is slower than the earlier published 4,400; the machine was busy and the difference is recorded rather than explained away. The README, the landing page and the architecture notes now quote these runs.',
  },
  {
    date: '2026-10-31',
    area: 'Security',
    title: 'Image uploads hold their line',
    brief:
      'A capped line for decoding, a 503 with Retry-After past it, and the upload limit checked before the bytes arrive.',
    summary:
      'Pictures are decoded two at a time, because a decode can take a lot of memory. Three things are firmer now. A finished decode hands its turn straight to the next upload in line, so a newcomer arriving at that instant can never make it three. The line itself is capped at eight: past that, an upload is told the service is busy and when to try again, instead of being held in memory without end. And the per-minute upload limit is checked with the size, before the image is received, so an upload over the limit is refused without its bytes being read.',
    checked:
      'Tests prove that however decodes overlap, and with each finished one asking for another at once, no more than two ever run together; that a full line refuses the next request at once; that an upload while every turn and place in line is taken is answered 503 with Retry-After; and that the upload past the per-minute limit is a 429. The full suite passes, and on the rebuilt stack the smoke test’s picture and image uploads went through.',
  },
  {
    date: '2026-10-31',
    area: 'Security',
    title: 'Old records are let go on a schedule',
    brief: 'Retry records replay for 30 days, read notifications go after 90.',
    summary:
      'Two tables only ever grew. The record that lets a retried change be recognised as a repeat, rather than done twice, was kept forever; it now replays for 30 days, which covers a long time offline with room to spare, and is then forgotten. Notifications you have read are removed 90 days after you read them; unread ones stay until you read them. Both are removed by the background worker’s hourly cleanup, which was granted only the two deletions it needs.',
    checked:
      'Tests prove the replay window is 30 days, that a retried change inside it still returns the original answer after the cleanup runs, that a key older than the window is forgotten, and that only notifications read more than 90 days ago are removed, unread and recently read ones kept. The cleanup in the tests runs as the worker’s own database account, so a missing grant would fail them. The full suite passes.',
  },
  {
    date: '2026-10-31',
    area: 'Site',
    title: 'Indexes for the work that runs on a clock',
    brief: 'A small index over pending jobs only, and one for removing expired sessions.',
    summary:
      'The background worker looks for due jobs, and once an hour expired sessions are removed. The jobs index covered every job ever run, finished ones included, which is most of the table in time; it is replaced by one over pending jobs only, by when they are due, which stays small however many jobs have finished. Expired sessions are now found through an index on when they expire, rather than by reading every session.',
    checked:
      'Tests prove the new jobs index covers due times for pending jobs only and the old one is gone, that the claim query uses it, and that removing expired sessions uses the new sessions index. The migration tool reads the history without complaint, and the full suite passes on the migrated database.',
  },
  {
    date: '2026-10-31',
    area: 'Security',
    title: 'One query to know who you are and where you are',
    brief: 'The session and your workspace role come from one database query.',
    summary:
      'Every request inside a workspace used to ask the database twice before doing anything: once for who the session belongs to, and once for that person’s role in the workspace. Now both come from one query, which joins the membership onto the session lookup for the workspace in the address. The access rules are the same: a stranger still gets not found, a member without the permission still gets forbidden, and an expired or idle session still counts as signed out.',
    checked:
      'Tests prove a member reading a workspace costs one query for the session and the membership together, with no second membership lookup; a stranger is still refused with not found from that one query; and a route with no workspace still looks up the session alone. The full suite, which covers every access rule, passes; the change had a security review; and the stack and browser smoke tests passed on the rebuilt stack.',
  },
  {
    date: '2026-10-31',
    area: 'ML',
    title: 'One call for both composer hints',
    brief: 'Duplicate hints and the suggested priority come from one request and one model load.',
    summary:
      'While you type a new issue’s title, the composer shows issues it may duplicate and suggests a priority. The two hints used to ask separately, and the API asked the suggestion service separately for each, so every settled title cost two round trips and two loads of the workspace’s models. Now one route answers both, the service fits or fetches the workspace’s models once for that answer, and the two hints share it. A malformed half of the answer costs only that hint, and a failing service still means no hints rather than an error.',
    checked:
      'Tests prove the route answers both hints from one call to the service, passes a refusal through with its counts, asks only about the caller’s own workspace, refuses non-members and the signed-out without calling the service, rejects a blank or missing title, and degrades to no hints when the service fails; the API’s client makes one request to the combined endpoint and keeps one half when the other is malformed; and the service’s combined answer matches its separate endpoints from one fit. In headless Chrome against the running stack, typing a title into the composer sent one request to the API and one to the service.',
  },
  {
    date: '2026-10-30',
    area: 'Product',
    title: 'Mail goes out the moment it is queued',
    brief: 'Queueing a job wakes the worker at once; it no longer polls every second.',
    summary:
      'The background worker used to look for work once a second, so a sign-up link or a password reset waited up to a second before it was even started, and an idle worker asked the database every second for nothing. Now queueing a job wakes the worker straight away, through a database notification sent in the same transaction: it arrives when the job can be seen, and never for a job that was rolled back. The worker still looks every 30 seconds, for anything due later or a notification it missed. While it waits, it keeps telling the health check it is alive, but only while its database was reachable at its last look.',
    checked:
      'Tests prove a queued job starts within 100 ms, a job queued in a transaction does not start before the commit and starts within 100 ms after it, mail jobs (which are queued their own way) wake the worker too, an idle worker keeps its heartbeat without asking the database for work, one whose database is gone stops beating, and no code inserts a job without waking the worker. On the rebuilt stack the smoke test’s emailed sign-up link arrived in 53 ms, where it took about a second before, and the idle worker stayed healthy past its 30-second check.',
  },
  {
    date: '2026-10-30',
    area: 'Product',
    title: 'Editing together works across gateways',
    brief:
      'Gateways tell each other which stored edit to read, so editors on different gateways see each other live.',
    summary:
      'Two people writing in the same document only saw each other’s words live if their browsers happened to be connected to the same live gateway. With more than one gateway running, one could type and the other see nothing until a reload. Now each gateway stores what its own editors write, as it always has, and tells the other gateways which stored update to read; a gateway with the document open reads it and passes it to its editors. The notice carries only ids, because an edit can be far larger than a database notification may be, and an edit already folded into the document’s snapshot is read from the snapshot instead.',
    checked:
      'A new test starts two gateways, connects one editor to each, opens one document on both, and proves text typed through the first gateway reaches the editor on the second. It runs as the gateway’s own database account, so no new grant was needed. The full suite passes, and on the rebuilt stack the stack and browser smoke tests passed with no relay errors in the gateway’s log.',
  },
  {
    date: '2026-10-30',
    area: 'Product',
    title: 'The live connection sends only what a page shows',
    brief: 'Pages name their project, issue or channel, and the gateway sends only those events.',
    summary:
      'Every open page used to receive every live event in its workspace, then throw most of them away. Now a page tells the gateway what it shows: a board names its project, an issue page its issue, the workspace view the workspace and the open channel. The gateway then sends only the events about those, so a board never hears a chat message and a channel never hears another project’s board. Scopes only narrow what a member already receives; they never widen access. A page that names nothing, like the home, still hears everything in the workspace.',
    checked:
      'Tests prove a socket scoped to a project hears that project’s issues and nothing of chat or other projects, a socket scoped to a channel hears its messages and nothing of boards, a socket that names nothing hears everything, and a malformed list of scopes is refused while the earlier scopes stay. In headless Chrome on the rebuilt stack, an open board’s socket received only the new issue in its own project, while a chat message and an issue in the workspace’s other project never reached it. The full suite and the browser smoke test pass.',
  },
  {
    date: '2026-10-30',
    area: 'Product',
    title: 'A board reads only when its issues change',
    brief:
      'No more reading on every chat message or every five seconds; bursts of events are handled once.',
    summary:
      'An open board used to read its whole issue list again on every live event in the workspace, a chat message included, and every five seconds besides. Now it reads only when an issue in its own project is filed, changed or deleted, or when the live connection comes back after a gap; the five-second timer only retries changes made offline, and only when there are some. An issue page refreshes only for its own issue, comments and images. Events that arrive within 150 ms of each other are handled once, so a teammate moving five cards is one read rather than five. A new issue now also refreshes the project list, which it did not before.',
    checked:
      'Tests prove a chat message causes no board sync and no issue refresh; a board pulls for its own project’s issues only; an issue page for its own issue, comments and images only; a new issue makes its project’s issues and the project list stale; and events within the window flush once, together. In headless Chrome against the running stack, an open board made no reads in seven idle seconds and none in seven seconds after three chat messages, and three issues filed in a burst appeared after a single read. The full suite passes.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'Every route described once',
    brief:
      'One definition per route types the API, the web app and a generated [OpenAPI document](openapi.json); describing them found and fixed real drift between what the API sent and what the web app expected.',
    summary:
      'A route used to be described three times: by the API handler, by a type the web app wrote by hand, and nowhere for anyone else. Now each of the 81 JSON routes is described once, in the shared package, with what it accepts and what it answers. The API serves it from that description, so its input is checked before the handler runs and its answer goes out through the same description, so a field nobody listed is never sent. The web app calls it from the same description, so its types cannot drift from what the API sends, and an OpenAPI document is generated from it. The two routes that answer with image bytes are listed apart, with that reason. Describing them found real drift: an edited issue answered without its key, a created or renamed document answered with its stored editing state and its search copy, created issues and messages carried their search vectors, the sign-in and sign-up answers were typed as the whole account when they carry only the public part, and a notification about no one thing was typed as always naming one. Each answer now matches its description, and the web app’s types match the answers.',
    checked:
      'Tests prove every described route is served and every served route is described or listed apart with its reason; that a workspace answer carries exactly the fields its description names; that an updated issue answers with its key and no search vector; that a document answer never carries its stored state; that a handler answering with the wrong shape is a server error rather than a reply, and is also a type error; that bad input is refused before the handler; that paths are encoded; and that docs/openapi.json is exactly what the descriptions generate. Asking for a reset link still answers the same for a malformed address. The full suite passes, the web app builds against the derived types, the account routes had a security review, and the stack and browser smoke tests passed on the rebuilt stack.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'The database library is current',
    brief: 'Drizzle 0.38 to 0.45, with error codes read through its new error wrapping.',
    summary:
      'Drizzle, the library every service uses to talk to Postgres, moves from 0.38 to 0.45, with its migration tool from 0.30 to 0.31. The one change that could have hurt quietly is that Drizzle now wraps a failed query in an error of its own, with the database’s error inside it: code that looked for the database’s error code on the outside would have stopped noticing, for example, that a username had just been taken by someone else. That code now looks through the wrapping, and was changed and released first, on the old version, so the upgrade itself changes nothing else.',
    checked:
      'A new test proves a unique violation and a missing reference are still recognised by their database codes through the wrapping, and that an unrelated error has none. The migration tool reads all 32 existing migrations and their history without complaint. Tests that check why the database refused something (permission denied, the audit trail’s append-only rule, its truncation guard and its key format) now read the database’s own message from inside the wrapping, and all pass. The full suite passes on the new version.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'CI installs exactly what is locked, and runs the Python tests',
    brief:
      'Frozen installs, a Python 3.11 job from a hashed lock, and caching for downloads and image layers.',
    summary:
      'Continuous integration now refuses an out-of-date lockfile instead of quietly resolving new versions, and the duplicate and priority service’s Python tests run on every push, on the Python version it ships with, from a locked set where every package is checked against its hash. Downloads and image layers are cached between runs, so an unchanged dependency or build step is restored rather than fetched or rebuilt again.',
    checked:
      'The locked Python test set was installed into a clean Python 3.11 environment with every hash required. The cached image build was tried locally on a fresh builder: the layers were exported, the builder emptied, and the rebuild restored its steps from the exported cache; with no cache present yet, the build still succeeds. The lockfile already records every platform’s native packages, which was the old reason CI could not install frozen. The new jobs’ first run on GitHub is the remaining check.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'One image library, and none in the web app',
    brief:
      "One sharp version across the repository; the landing's screenshots are WebP made at build, and the web image carries no image library.",
    summary:
      'The API resizes uploads with sharp, and the web app used to carry a second copy that Next.js loads to resize pictures on each request. Now there is one version of sharp, the current one, across the repository. The landing’s screenshots are converted to WebP at the size the page shows them, once, before each build, and the web app serves them as they are, so its image no longer holds an image library at all. Each screenshot is about a quarter of the size of the picture it replaces.',
    checked:
      'Tests prove the lockfile resolves sharp to a single version with matching native binaries, that Next is set to serve images as they are, and that the landing asks only for WebP files that each have a source to be made from. The image check now also looks inside the web image: it found sharp there before and finds none after. The API’s image tests pass on the new version, and the full suite passes. On the rebuilt stack every service came up healthy and the stack and browser smoke tests passed.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'Every package lists what it uses',
    brief:
      'The top level installs only tooling; the tests and scripts are packages that declare their imports, checked in CI.',
    summary:
      'The repository’s top level used to install the database driver, the web server, the image library and every one of its own packages, so the tests and scripts worked whether or not anything declared what they used. It now installs only the tools that run across everything: the formatter, the type checker and the runtime’s types. The tests and the scripts are packages of their own that list what they import, and nothing reaches into another package by a relative path.',
    checked:
      'A new test reads every source file in the repository and fails on an import its package does not declare, or a relative import that leaves its package, and checks that the top level holds only the three tools. It found 11 tests reaching into the web app and 2 into the scripts by path, and 19 packages installed at the top level; all are fixed, and planted examples of each mistake are caught. It runs in CI. The full suite passes, every image builds from the locked dependencies, and on the rebuilt stack the image, stack and browser smoke tests passed.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'Each image carries only its own service',
    brief:
      "The gateway and worker images no longer hold the API's web server or image library, and CI checks each image after building it.",
    summary:
      'The API, the live gateway and the worker used to share one dependency install, so every image carried everything any of them needed. Each now installs only its own service’s packages: the gateway and the worker no longer carry the API’s web server or its native image library, and each is about 70 MB smaller. Fewer packages in an image is less to patch and less for a scanner to find.',
    checked:
      'A new check, run in CI right after the images are built, looks inside each image: the gateway and worker images must hold no sharp and no Fastify, and the API image must hold both, which shows the search would find them. It failed on the old images, which carried both, and passes on the new ones. On the rebuilt stack the migrator and seed exited cleanly, every service came up healthy, and the stack and browser smoke tests passed.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'No service reaches into another',
    brief:
      'File storage is a package of its own, the worker no longer depends on the API, and a test in CI refuses any import from one service into another.',
    summary:
      'Where uploaded files are kept, on disk or in any S3-compatible store, is now a package of its own that the API and the worker both use. Before, the worker borrowed it from inside the API, so the worker depended on the whole API package, its web server and its image library included. Now no service imports another: the API, the live gateway and the worker share code only through packages made for sharing, so each can be built, deployed and scaled on its own.',
    checked:
      'A new test reads every source file and package manifest of the three services and fails on any import of another service, by package name or by relative path; it failed on the worker before the move and passes after, and a planted example of each kind of import is caught. It runs in CI with the suite. The full suite passes, and on the rebuilt stack the smoke test stored an image in S3 with the worker running from the new package.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'Every workspace has a storage limit',
    brief:
      'Each workspace can store up to 1 GB of images; an upload past it is refused before it is read, and owners see the usage on the home.',
    summary:
      'Each workspace can now store up to 1 GB of images. An upload that would go past it is refused before any of it is read, with a message saying an owner can make room by deleting old images, so one workspace cannot fill the disk for everyone. Owners see how much is used on the workspace’s tile on the home, as a thin bar in the workspace’s colour with the figures beside it; other members are not shown it.',
    checked:
      'Tests prove an upload goes through while there is room, is refused with 413 and storage_quota_exceeded once the workspace is within a few bytes of its limit, and that someone outside the workspace still gets the usual not found rather than learning its usage; and that the home overview reports usage to owners and nothing to a member. The full suite passes.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'Delete your own account',
    brief:
      'Delete your account from Account settings, with your password and a choice for each workspace you own; your details are removed and your work stays under "Deleted user".',
    summary:
      'Account settings now let you delete your account yourself. You confirm with your password, and for each workspace you own you choose: hand it to one of its members, who becomes its owner, or delete it with everything in it. Then every session ends, your name, email, username, picture and password are removed, and your picture’s file is deleted; what you wrote in workspaces that stay is kept under “Deleted user”. Your details in the audit trail are erased by the erasure tool’s own account, which the deletion asks for, since the app itself is not allowed to erase. The erasure design is a draft for legal review.',
    checked:
      'Tests prove deletion needs the right password, refuses until every workspace you alone own has a decision, hands a workspace only to a member and makes them owner, deletes a chosen workspace and queues its files for removal, ends every session so the account cannot sign in again, keeps your work under Deleted user, and, once the erasure has run, leaves no column of any table holding your email, name or username. Walked in headless Chrome: a new account signed up, deleted itself from Account, landed on the front page and could not sign in again.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'Erasure has its own key, and leaves a receipt',
    brief:
      "Only `audit:erase`'s own account can blank the audit trail's personal fields, and each erasure records counts and a commitment, never the person.",
    summary:
      'Blanking a person’s details out of the audit trail used to be something the app’s own database account could do. Now only the erasure tool’s own account can, and the app cannot read or write the record of erasures either. Each erasure, done in one step, removes the person’s fields and former usernames and writes a receipt: when it happened, how many records it changed, and a commitment to whom that names nobody on its own. The tool prints a one-time value to keep with the request; with it, the receipt proves which request it answered. The erasure design is a draft for legal review.',
    checked:
      'Tests prove the app’s account is refused any change to the personal fields and any read or write of the erasure record; that the erasure account can erase but its attempt to rewrite rather than blank is refused by the trail’s own trigger, and every other column is out of its reach; and that an erasure blanks every field, records the counts, and stores a commitment that matches the person and the printed value while the record itself contains neither.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'A database account per service',
    brief:
      'The gateway and the worker each connect as their own database account, granted only what their code does.',
    summary:
      'The live gateway and the background worker no longer share the app’s database account. Each connects as its own, granted only what its code does: the gateway can check a session and a membership and keep documents in step, and the worker can run its jobs, send its mail and notifications, tidy up expired records and stream the audit trail. Neither can change an issue, a person or a membership, and the worker reads the audit trail without being able to alter it. With the duplicate service’s read-only account, every service now has the narrowest access it can work with.',
    checked:
      'The gateway’s and the worker’s own test suites now run as their accounts, so a grant either needs and lacks fails a test; finding the gaps that way added exactly what compaction, the nudge scan and the audit stream use. New tests prove the gateway is refused changes to issues, people and memberships and any read of the audit trail or the job queue, and the worker is refused changes to issues, people, memberships and the audit trail and any read of document contents. The full suite passes, and on the rebuilt stack the migrator made all four accounts and both smoke tests passed with the services running as them.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'The ML service can read one view, and nothing else',
    brief:
      'The duplicate and priority service has a database account that can read one view of issue fields, owned by the migrations, and nothing else.',
    summary:
      'The duplicate and priority service used to connect with the same database account as the rest of the app, which could read and change nearly every table. It now has an account of its own that can read one view, made by the migrations, holding only the issue fields its models use: no other table, and no writing at all. A column added to issues later stays out of its reach until someone adds it to the view on purpose. The service’s own notes no longer claim a setting it chooses for itself is enforced by the database.',
    checked:
      'Tests prove the view has exactly the columns the service reads, and that its account can read the view but is refused the issues, users and sessions tables and any change to the view. The service’s 96 Python tests pass against the view, and on the rebuilt stack, running as that account, it still found the duplicate of a seeded issue.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'The whole stack tested as production runs it',
    brief:
      'CI now also runs the stack in production mode: HTTPS through the proxy with a throwaway certificate, mail over TLS, a fresh audit key and no demo data, driven by the same end-to-end and browser tests.',
    summary:
      'Every push now also runs the whole container stack in production mode: every service told it is production, the edge proxy serving HTTPS with a throwaway certificate made for that run, mail sent over TLS because plain mail is refused, a fresh signing key for the audit trail, and no demo data. The same end-to-end and browser tests then drive it, so a rule that only applies in production (a Secure host-only cookie, HSTS, an https web address, encrypted mail) is exercised before anything is deployed, not first discovered after.',
    checked:
      'Run locally and added to CI: the stack came up healthy in production mode behind HTTPS; the end-to-end test signed up from the emailed link (which the worker could only send over TLS), checked the session cookie is the __Host- one, joined the live socket, created an issue and uploaded an image; and the browser test loaded every page with no security policy violation. The development stack is unchanged and still tested first.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'One address for the whole app',
    brief:
      'The app, the API and the live gateway share one address behind an edge proxy: one web image runs anywhere, a production build pointing at localhost is refused, and no other site is allowed to read the API. See [DEPLOY.md](DEPLOY.md).',
    summary:
      'The web app, the API and the live gateway now sit behind one address: an edge proxy serves the app at /, the API at /api and the gateway at /ws. The web app holds no addresses of its own, so one built image runs anywhere, and a production build that points at localhost is refused. With one origin the API no longer tells any other site it may read its answers, and only the proxy is reachable from outside; the API, gateway and everything behind them are on the private network. A new deployment guide sets out the layout and how many database connections each service needs.',
    checked:
      'Tests prove a production build refuses a localhost API or gateway address and accepts relative or real ones, and that no API response or preflight grants another site access. The stack smoke test signed up, joined the live socket over /ws, created an issue and uploaded an image, all through the proxy, and the browser smoke test loaded every page under the security policy through it.',
  },
  {
    date: '2026-10-23',
    area: 'Product',
    title: 'A live river of your team’s two weeks',
    brief:
      'Two weeks of activity as a river, one band per workspace in its colour; hover a day for counts, and each live change ripples from today.',
    summary:
      'The signed-in home has a picture of its own now, instead of the landing page’s field: two weeks of your team’s activity as a river, one band per workspace in its theme’s colour, stacked, so you can see when the team was busy and where. Hover a day for each workspace’s count; when a teammate changes something, a ripple goes out from today’s edge of that workspace’s band. Behind it, an aurora in the colours of the time of day. Rising numbers show a small +1, tiles lean toward the pointer, feed lines carry their workspace’s colour and assigned issues their status colours. The demo has three workspaces in three themes. Still under reduced motion.',
    checked:
      'Tests prove the river stacks each workspace on the ones before it, that its curves never dip below zero or rise above the peak, and the palette for each part of the day. Headless Chrome watched a teammate’s change arrive live and checked the phone layout, reduced motion and the security policy. The demo seed adds the two new workspaces to an existing demo account without touching anything else, and a full reseed now only deletes workspaces the demo accounts created.',
  },
  {
    date: '2026-10-23',
    area: 'Product',
    title: 'A live home after you sign in',
    brief:
      "The first page after signing in now greets you over the landing's field of points, which ripples with your teammates' changes, and shows what is assigned to you, a live feed, and a tile per workspace with its open issues, activity and who is here now.",
    summary:
      'The page you land on after signing in used to be a plain list of workspace names. Now it greets you over the same moving field of points as the landing page, and that field reacts to your own workspaces: every change a teammate makes sends a ring across it, it quickens while someone else is here and greys if the connection drops. Below it, the open issues assigned to you, a live feed of what is happening, and a tile for each workspace with its open issues, two weeks of activity, who is in it and who is here right now, and what happened last. Tiles pulse when their workspace changes, and the numbers count to their new values. Everything is still under reduced motion, works from the keyboard and fits a phone.',
    checked:
      'Tests prove the new overview counts open issues and two weeks of activity, lists the open issues assigned to you newest first with the true total beyond five, names the latest action without a comment’s text, and includes only workspaces you are in, even if an issue there is still assigned to you after you leave. Headless Chrome signed in as the demo owner, watched a teammate open an issue from another session arrive in the feed and pulse its tile, and checked the phone layout, reduced motion and that the page raises no security policy violation; the browser smoke test in CI now loads it too.',
  },
  {
    date: '2026-10-23',
    area: 'Security',
    title: 'One configuration loader that fails closed',
    brief:
      'Every service and command-line tool reads its settings the same way, and in production a missing database or web address, or a plain-http one, stops it at start-up instead of falling back to localhost.',
    summary:
      'The API, the realtime gateway, the worker and every command-line tool now read their settings through one loader with one set of rules. The environment must be named; nothing guesses. In production nothing falls back to a local default: a missing database address or web address, or a web address that is not https, stops the service at start-up with every problem listed, instead of quietly connecting to localhost or mailing links nobody can open. Before, the command-line tools fell back to a local database even in production, and the gateway to a local web address.',
    checked:
      'Tests prove the loader refuses an unset environment, uses local defaults only outside production, refuses a missing or plain-http web address and a missing database in production, requires the owner’s own address for migrations in production and refuses a service given only that one, never repeats a rejected web address (it may hold a password), and reports every problem at once. Every entry point, the API, gateway, worker and five command-line tools, is started in production with no database and must refuse, naming it; the five tools did not before. Each runs without the developer’s own .env file, so it cannot supply the answer.',
  },
  {
    date: '2026-10-23',
    area: 'Site',
    title: 'The demo account is ready in the container stack',
    brief:
      'The stack now seeds `rohit@robis.test` (password `robis-demo-password`) as owner of a populated workspace, with a confirmed address and a picture, so it can be tried without signing up.',
    summary:
      'Starting the container stack now creates the demo accounts, so it can be tried without signing up: rohit@robis.test, password robis-demo-password, owner of an Engineering workspace with projects, issues, channels and a team of three. The demo people start with a confirmed address and a picture, so signing in goes straight to the workspace. It happens once: later starts leave the accounts and anything changed in them alone. The demo password is refused in production, as before.',
    checked:
      'On the rebuilt stack, the seed ran on first start and reported four people, two projects and ten issues; a second start reported the owner already there and changed nothing; and in headless Chrome, signing in through the form as rohit@robis.test landed in the Engineering workspace as owner, with no welcome screen. The stack and browser smoke tests and the CI health check, which now expects the seed to have exited cleanly, all pass.',
  },
  {
    date: '2026-10-23',
    area: 'Security',
    title: 'A strict security policy for every page',
    brief:
      'Pages run only scripts the server stamped for that response, so injected script cannot run; nothing may frame Robis; HTTPS is pinned in production; and only the camera is allowed, for Robis itself. A browser test in CI loads the real pages and fails on any violation.',
    summary:
      'Every page now carries a Content-Security-Policy that runs only the scripts the server stamped with a fresh one-time value, so a script or event handler slipped into a page cannot run. Nothing may show Robis inside a frame, which stops clickjacking. Browsers are told to use HTTPS only, the camera is allowed for Robis itself (the welcome screen takes a picture) and every other powerful feature, such as the microphone and location, is turned off. The sign-up page now gets the same no-referrer, no-store treatment as the reset and verification pages, and the offline cache never keeps a page carrying a one-time link. Next.js is now on 15.5.28, which fixes a critical flaw in image optimisation.',
    checked:
      'Tests pin the policy: scripts only by nonce with strict-dynamic, no unsafe-inline or eval outside development, frame-ancestors none, connections only to the app, the API and the gateway, the camera for this origin only, and HSTS in production only, for this host; and that every API response forbids running script, framing and sniffing. A new browser smoke test, run in CI against the container stack, loads the landing, sign-in, sign-up, intro, How it works and What’s new pages and a signed-in workspace in Chrome and fails on any policy violation; it found zod probing for eval, now switched off in the browser. It also serves a page with a script and an onclick handler injected into its HTML, as a stored cross-site script would be, and checks that neither runs and both are reported. It also checks each response has a fresh nonce matching its scripts, that the WebGL landing is drawing with its own program, that a signed-in workspace stays clean once its API calls and socket have run, and, in a separate Chrome check, that the offline cache keeps the sign-in page but not a sign-up link.',
  },
  {
    date: '2026-10-23',
    area: 'Security',
    title: 'Sign up with your email first',
    brief:
      'Creating an account now starts with just your address and always says "check your inbox", so the form never reveals who already has an account. The link in that email finishes signing up, works once for 24 hours, and confirms your address as it does. Asking again never cancels a link already sent.',
    summary:
      'Creating an account used to say “an account with that email already exists”, which let anyone check whether an address was registered. Now sign-up starts with just your address and always answers “check your inbox”, after the same short wait either way. A new address gets a link that finishes signing up, where you choose your name, username and password; an address that already has an account gets a reminder to sign in instead, so only whoever reads that inbox learns which it was. The link works once, for 24 hours, and opening it confirms your address, so a new account starts confirmed and can join workspaces at once. Asking again sends another link without cancelling the first, the link is taken out of the address bar once the page has read it, and a sign-up nobody finishes is cleared away a week after its link runs out.',
    checked:
      'Tests prove starting a sign-up answers the same status and body for a new address and a registered one, mails a finishing link to the first and a reminder without a link to the second, is limited per address, and refuses something that is not an address; that the link creates a confirmed account with the consent recorded, works once, expires, is not cancelled by someone asking again for the same address, makes one account when two finishes race with it, and survives a refused username; that unfinished sign-ups are swept a week after their link runs out while recent ones stay; and that a second sign-up for a registered address in any letter case makes no account. Every other suite now signs people up the same way. The stack smoke test signs up from the link the worker actually mailed, and the form was walked in headless Chrome from address to inbox to finished account, and at phone width, checking the link leaves the address bar and the form still finishes.',
  },
  {
    date: '2026-10-20',
    area: 'Security',
    title: 'Email invitations that give nothing away',
    brief:
      'Inviting by email answers the same whether or not the address has an account, sends the same email either way, and the pending list shows the address as typed. Whoever owns the address sees the invitation once it is confirmed. The cap on unanswered invitations now counts per sender, so throwaway workspaces cannot block a real one, and a reserved name spelled with a 1 for an i (adm1n) is refused.',
    summary:
      'Inviting someone by email used to say “no account exists with that email”, which let anyone with a workspace check whether an address was registered. Now an email invitation answers the same whether or not the address has an account, the same email goes to it either way, and the pending list shows the address as typed, never who it turned out to be. Whoever owns the address sees the invitation once their address is confirmed, including someone who signs up later. The cap on unanswered invitations now counts per sender, so a stranger with throwaway workspaces cannot fill anyone’s and block a real team, and a reserved name spelled with a 1 for an i, such as adm1n, is refused.',
    checked:
      'Tests prove an invitation to an address with an account and one without answer with the same status and body, send the same email and show alike in the pending list; that an unconfirmed account does not see an email invitation and a confirmed one can accept it; that a later sign-up with the address sees it; that inviting a member’s address changes nothing and says the same; that twelve strangers with throwaway workspaces cannot block a real invitation while one sender with 50 waiting is refused the next; and that adm1n is reserved while 1ndex is not.',
  },
  {
    date: '2026-10-20',
    area: 'Security',
    title: 'Safer by default before going live',
    brief:
      'Every service refuses to start without being told which environment it is in. In production the session cookie is always Secure and host-only. Writes from another site are refused. Metrics moved off the public port. A session unused for 7 days ends, and deleting a workspace asks for your password.',
    summary:
      'A review before deployment tightened the defaults. The API, the live feed, the worker and the command-line tools now refuse to start unless they are told whether they are in development, test or production, instead of assuming development. In production the session cookie is always Secure and carries the __Host- prefix, so no other subdomain or plain-http page can set it. Writes from another website are refused before they are read, the same check the live feed already made. Metrics moved to an internal port, while the health check stays public. A session unused for 7 days now ends, within the 30 it can live, and deleting a workspace asks for your password.',
    checked:
      'Tests prove each service and tool refuses to start without NODE_ENV and with an unknown one; that a production sign-up sets a Secure __Host- cookie even with COOKIE_SECURE=0, and that it is the cookie recognised; that a write with another site’s Origin or a cross-site Sec-Fetch-Site is refused while the web app’s own origin, same-site and tools without browser headers are not, and reads are not touched; that /metrics answers 404 on the public port and is served on its own; that a session unused for 8 days is refused and one used 6 days ago is not; and that deleting a workspace without the password, or with a wrong one, deletes nothing.',
  },
  {
    date: '2026-10-20',
    area: 'Security',
    title: 'Asked again when the terms change',
    brief:
      'Sign-up now keeps when you confirmed your age and which version of the terms you agreed to. When the terms change, you are asked again before you go back into a workspace. Accounts whose username was given to them are asked once to keep it or pick their own.',
    summary:
      'Sign-up now keeps when you confirmed your age and which version of the terms you agreed to. When the terms change, you are asked again before you go back into a workspace, and the server holds the line the same way it does for a profile picture: workspace pages, the live feed and the inbox wait for an answer, while your account and the way out of a workspace stay open. Accounts whose username was given to them rather than chosen are asked once to keep it or pick their own. The terms, the privacy notice and the minimum age are drafts for legal review.',
    checked:
      'Tests prove sign-up stores the age confirmation time and the terms version, that a page showing old terms cannot sign anyone up, that an account on old terms is refused workspace routes (403) and the live feed until it agrees, that agreeing is in your own account history with the version, that agreeing to anything but the current version is refused, that leaving a workspace never needs an answer while accepting an invitation does, that a sign-up which does not say what it showed is asked on first visit, that answering again changes nothing, and that keeping or changing a given username both count as confirming it. Walked through in headless Chrome against the containers rebuilt from this code: an account on old terms sent to the question, then its username, then back where it was going, and at phone width. A security review found sign-up writing no history entry and repeat answers overwriting the first; both are fixed.',
  },
  {
    date: '2026-10-16',
    area: 'Product',
    title: 'Invitations you answer',
    brief:
      'Adding someone to a workspace now sends them an invitation. It shows in their inbox and on their workspaces page, and nothing joins their list until they accept. Joining needs a confirmed email address; admins see who has not answered and can withdraw an invitation.',
    summary:
      'Adding someone to a workspace now sends them an invitation rather than putting them in it. It arrives in their inbox and waits on their workspaces page, and nothing joins their list until they accept; they can decline instead. Accepting needs a confirmed email address, which settles what a confirmed address is for. Admins see who has not answered yet and can withdraw an invitation.',
    checked:
      'Tests prove an invited person is not a member until they accept (the workspace is a 404 to them until then), that the invitation reaches their inbox, that accepting is refused until the address is confirmed and then makes them a member, that accepting twice with one key joins once and answers the same, that declining and withdrawing both close it, that nobody but the invited person can answer it, that the pending list is 404 outside the workspace and 403 without the right to invite, that an invitation is not sent twice or to a member, that only an owner can invite an owner, that an invitation lapses if its sender can no longer invite, that an admin cannot withdraw an invitation above their rank, and that one person cannot be sent more than ten at once. Every other suite now adds members through the same invite and accept path. Walked through in headless Chrome against the containers rebuilt from this code: invite, the inbox, Join waiting on a real confirmation email from the mail sink, joining, and at phone width. Reviewed for correctness, security and React; their findings are in.',
    feature: {
      name: 'Ask people in, and let them say yes',
      where: 'Members on a workspace page; Invitations on your workspaces page.',
      layers: [
        'Screens: Join and Decline beside each invitation, and a prompt to confirm your email first.',
        'API: invite, list, accept, decline and withdraw, each audited and safe to retry.',
        'Database: one pending row per person and workspace, gone once answered.',
        'Trail: invited, joined, declined and withdrawn, each by the person who did it.',
      ],
    },
  },
  {
    date: '2026-10-16',
    area: 'Security',
    title: 'A username nobody else can wear',
    brief:
      'Lookalike names (`ada.l` and `ada_l`, `b0b` and `bob`) count as the same name. A name you let go is held for 90 days, and only you can take it back. A mention points at the person it meant when it was written, so an old `@name` never reaches whoever takes that name later.',
    summary:
      'Lookalike usernames now count as the same name: dots and underscores are ignored, 0 reads as o and 1 as l, so ada.l, ada_l and adal cannot all exist, and neither can b0b beside bob. A username you let go is held for 90 days, and only you can take it back; an account can hold three old names at once, so nobody can sit on a list of them. Every mention is tied to the person it meant when the comment was written, so if Bob renames and someone else later takes his old name, old comments still point at Bob, show his new name beside the old one, and notify only him.',
    checked:
      'Tests prove the code and the database derive the same key, that sign-up, renames and the availability check all refuse lookalikes and held names, that the owner can take a held name back, that a fourth hold is refused, that a sign-up racing a rename never gets the released name (both names are locked during a rename), that a hold ends after 90 days and is swept, that erasing a person forgets their old names but keeps the hold, that a rename is in your own account history without the names, and that a mention written before a rename still points at the right person. The migration was applied to a scratch database holding colliding names; the earliest account kept its name, the others got the lowest free suffix, and an old comment’s mention of a renamed account still found it. Reviewed for correctness, security and the database; the rename race and the hold cap came from those reviews.',
  },
  {
    date: '2026-10-16',
    area: 'Site',
    title: 'A short tour before you sign up',
    brief:
      'Get started opens six slides of their own first: sourced quotes from Grace Hopper, Eisenhower and Fred Brooks, a messy desk to sort into a board, a tunnel where notes wait for signal, what signing up asks for, then the form, over a loom of slow threads. A two-finger trackpad swipe turns the slide.',
    summary:
      'Get started now opens six slides of their own instead of the sign-in form, rather than the landing page again: three sourced quotes on habit, plans and teams (Grace Hopper, Eisenhower, Fred Brooks), a messy desk of notes to sort into a board, a train tunnel where notes wait for signal and then go in order, what signing up asks for, and then the form. A loom of slow threads moves behind it, tinted for each slide and dimmed in the tunnel. A two-finger trackpad swipe turns the slide.',
    checked:
      'Tests hold the slides to their rules (short titles, a name for each, no dashes), each quote to a named source with a year, and the keys, touch swipes and trackpad to their edges: one swipe with its inertial tail turns exactly one slide, either way, and a vertical scroll turns only once a tall slide has no more to scroll. Walked through in headless Chrome with trackpad-shaped wheel bursts, sorting the desk and riding the tunnel, at desktop and phone widths, ending on Create account, which opens the form in sign-up mode.',
    feature: {
      name: 'See it before you sign up',
      where: 'Get started on the landing, How it works and What’s new pages.',
      layers: [
        'Slides: trackpad, wheel, keys, touch swipe or the picker; nothing moves on its own, and Skip goes straight to sign up.',
        'Things to touch: a desk to sort, and a tunnel that holds your notes until the signal is back.',
        'Background: a 2D canvas of threads that part around the pointer and pause when hidden.',
        'Reduced motion: every slide is simply there, and the threads hold still.',
      ],
    },
  },
  {
    date: '2026-10-15',
    area: 'Security',
    title: 'Your own sign-in history, and a way to erase someone',
    brief:
      'Account settings show your sign-ins, failed attempts, password changes and sessions signed out, signed and seen only by you. Member events keep usernames beside the trail, so a person can be erased without breaking the chain (a design, for legal review).',
    summary:
      'Account settings now show what has happened to your account: sign-ins, failed attempts, sign-outs, password changes and resets, sessions signed out, signed and chained like the workspace trail, and seen only by you. Separately, member events now keep usernames beside the trail rather than inside it, so a person can be erased from it without breaking the chain. The erasure design is a draft for legal review.',
    checked:
      'Tests prove each kind of event is recorded, a failed sign-in only for a real account and only after the reply, nothing is kept about where a sign-in came from, nobody else can read the history, an edited event is named, and the runtime role cannot change one. For erasure: the username leaves every event and the chain still verifies, a changed username is caught, and the role can erase but change nothing else. The account page was checked in a real browser.',
    feature: {
      name: 'See what happened to your account',
      where: 'Account, Sign-in history.',
      layers: [
        'Account page: the history newest first, failed attempts marked, and a check of the chain.',
        'API: yours alone; a failed sign-in is written after the reply so timing says nothing.',
        'Database: a chain per account, signed with the audit key, append-only for the app.',
        'Erasure: bun run audit:erase removes a person’s fields; the chain verifies after.',
      ],
    },
  },
  {
    date: '2026-10-15',
    area: 'Security',
    title: 'An audit trail that records who reads it',
    brief:
      "Reading, exporting and checking the trail are events in it, and a link on another site cannot add one in an admin's name. Checks start from a signed checkpoint, so they stay quick, with a full check one click away, and the who filter lists former members by username.",
    summary:
      'Reading, exporting and checking the trail are now events in it, kept out of the members’ activity feed. Checks start from the last verified point, stored with a signature, so they stay quick as the trail grows; a full check is one click away. The who filter now lists former members too, by username.',
    checked:
      'Tests prove each read, export page and check leaves an event naming who did it, a cross-site navigation can neither read nor add a read, repeated reads within a minute count once, a second check walks only what is new, a checkpoint changed in the database is rejected and cannot be moved back or removed, a trail cut back past its checkpoint is reported as truncated, an edit behind the checkpoint is caught by the full check, and full checks have their own smaller budget. The Security view was checked in a real browser against the container stack.',
    feature: {
      name: 'See who looked',
      where: 'Workspace, Activity, Security (admins and owners).',
      layers: [
        'Security view: a who filter with former members marked, and a full check beside the quick one.',
        'API: every read, export page and check is appended to the trail it looked at.',
        'Checkpoints: the last clean point, signed with the audit key, so a check walks only what is new.',
        'Database: a moved or invented checkpoint fails its signature and the whole trail is walked.',
      ],
    },
  },
  {
    date: '2026-10-15',
    area: 'Security',
    title: 'An audit trail the database cannot quietly rewrite',
    brief:
      'The app connects as a role that can add audit events but not change, remove or empty them, and new events are signed with a key kept outside the database. A rewrite without the key is caught, even of a whole chain.',
    summary:
      'The app now connects to the database as a role that can add audit events but never change, remove or empty them, and cannot switch off the trigger that guards them. New events are signed with a key kept outside the database, recorded by id so keys can rotate.',
    checked:
      'Tests run the whole suite as that role, and prove it is refused an edit, a removal and emptying the table even with the trigger switched off. A row re-hashed without the key, the tail of a chain rewritten unsigned, a whole chain rewritten unsigned and an empty key id are each caught, and older events still verify after a key rotation. Deleting a workspace leaves a tombstone the role cannot touch, and the stream cursor only moves forward. The container stack runs as the role too.',
  },
  {
    date: '2026-10-15',
    area: 'Site',
    title: 'Every service as a container, checked on every push',
    brief:
      'Images for the web app, API, gateway, worker and ML service, and one compose file that runs them with Postgres, object storage and a mail catcher. CI builds them, waits for every health check, drives the stack end to end, and fails on fixable critical vulnerabilities.',
    summary:
      'The web app, API, realtime gateway, worker and ML service each have a container image, and one compose file runs them together with Postgres, object storage and a mail catcher. CI builds every image, starts the stack, and drives it the way a new person would.',
    checked:
      'On every push, CI waits for every health check, then signs up, confirms the address from the email the worker sent, creates a workspace and an issue, watches it arrive over the WebSocket, and attaches an image to object storage. It boots the API and worker in production mode to show they refuse to start without mail, and fails on any critical vulnerability in an image that has a fix. All of it was also run on the development machine.',
  },
  {
    date: '2026-10-13',
    area: 'Product',
    title: 'Reset and confirmation emails over real mail',
    brief:
      'Password resets and address confirmations go out over SMTP, sent by the worker so a slow mail server never slows a request. Failed sends retry, then stay visible as dead letters. `bun run mail:start` runs a local inbox.',
    summary:
      'Password resets and address confirmations now go out over SMTP, sent by the background worker so a slow mail server never slows a request. A failed send is retried and then kept where it can be seen, and a local inbox shows every message during development.',
    checked:
      'A test sends a reset through the real SMTP driver to a local mail server, follows the link and signs in with the new password. Another points the driver at a closed port and watches the job retry and then become a dead letter. Production still refuses to start with no mail driver configured.',
    feature: {
      name: 'Get back in from your inbox',
      where: 'Forgot password on the sign-in page, or the confirmation email after sign-up.',
      layers: [
        'Screens: the same forms, and the same answer whether or not the address has an account.',
        'API: queues one job naming the account, never the link, and answers in a fixed time.',
        'Worker: issues the link when it sends, over SMTP, retrying with backoff before a dead letter.',
        'Development: bun run mail:start catches every message in a local inbox on port 8025.',
      ],
    },
  },
  {
    date: '2026-10-13',
    area: 'Security',
    title: 'The demo password works only in development',
    brief:
      "Outside development the API refuses the README's demo password everywhere, and the seed script refuses to run against production.",
    summary:
      'The seeded accounts share a password printed in the README. Outside development the API refuses it at sign-in, sign-up, password change and reset, and the seed script will not run against production at all.',
    checked:
      'Tests prove signing in with it fails exactly like a wrong password, each way of setting it is refused, a refused reset does not spend the link, and a development app still accepts it.',
  },
  {
    date: '2026-10-13',
    area: 'Product',
    title: 'Images on issues and comments',
    brief:
      'Attach a photo, take one with the camera, or paste a screenshot. Images are stripped of metadata, screenshots stay lossless, and only members can open them. One added with no network waits on the device and uploads exactly once on reconnect. Storage is local disk or any S3-compatible store, and deleting an issue, comment or workspace removes its files.',
    summary:
      'Attach a photo, take one with the camera, or paste a screenshot onto an issue or into a comment. Only members can open them, and one added with no network waits on the device and uploads exactly once when it returns.',
    checked:
      'Tests prove a non-member gets a 404 for a valid image, a stored photo keeps no location data, a replayed offline upload stores one file, and deleting an issue removes its files. The S3 driver passes the same contract tests as local disk. Offline upload was driven in a real browser.',
    feature: {
      name: 'Show it, do not just describe it',
      where: 'Any issue: Add image, Camera on a phone, or paste a screenshot anywhere on the page.',
      layers: [
        'Issue page: a grid with a full-size viewer, plus images under each comment, with waiting uploads marked.',
        'Offline queue: the image is kept on the device and sent once, keyed so a retry stores nothing new.',
        'API: bytes checked and re-encoded with metadata removed, screenshots kept lossless, members only.',
        'Storage: local disk or any S3-compatible store, files removed by a job when their issue goes.',
      ],
    },
  },
  {
    date: '2026-10-13',
    area: 'Site',
    title: 'Documentation that agrees with the code',
    brief:
      'Every relative link in every Markdown file resolves, test counts live in one place (the roadmap), and CI checks both on every push, including proving the check fails on a deliberately broken link.',
    summary:
      'The architecture guide pointed at folders that no longer existed and four documents quoted four different test counts. Every link now resolves, counts live in one place, and CI checks both on every push.',
    checked:
      'A link checker runs in CI over every Markdown file and over the paths the app inventory names; a second CI step runs it on a fixture with a known broken link and requires it to fail.',
  },
  {
    date: '2026-10-13',
    area: 'Product',
    title: 'A picture before you start',
    brief:
      'New members upload a photo, take one with the camera, paste a screenshot or pick a generated pattern before using a workspace; the API and the live feed hold that line too. Photos are re-encoded with all metadata removed, location included, and are shown only to people who share a workspace.',
    summary:
      'New members choose how they appear before they use a workspace: upload a photo, take one with the camera, paste a screenshot, or pick a generated pattern. Pictures appear beside everything a person does, and only to people who share a workspace with them.',
    checked:
      'Tests prove an uploaded photo keeps none of its metadata, a stranger gets a 404 for it, replacing it deletes the old file, and a member without a picture is refused by the API and the live feed alike. The whole flow, camera included, was driven in a real browser.',
    feature: {
      name: 'Put a face to your name',
      where: 'Signing up, or Account later. The app asks before anything else.',
      layers: [
        'Welcome: upload, camera with a live round preview, paste, or a pattern, with one preview.',
        'API: photos decoded and re-encoded to 512 px with metadata removed; served only to teammates.',
        'Gate: workspaces stay closed over HTTP and the live feed until a picture is chosen.',
      ],
    },
  },
  {
    date: '2026-10-09',
    area: 'Product',
    title: 'Usernames',
    brief:
      'Everyone picks an `@username` at sign-up; teammates add and mention each other by it. Email addresses are shown only to workspace admins, and the audit trail names people by username, not email. Sign-up now asks for an age confirmation and links draft terms and privacy pages, both marked for legal review.',
    summary:
      'Everyone picks an @username when they sign up, and that is how teammates find, add and mention each other. Email addresses are now shown only to workspace admins, and the audit trail names people by username instead of by email.',
    checked:
      'Tests cover the rule, taken and reserved names, changing a username, adding someone by username, admins-only email in the member list, and that member events carry no email or real name. Signed up through the real form in a browser.',
    feature: {
      name: 'An @username for everyone',
      where: 'Sign up, or Account to change it. Add teammates by @username from Team.',
      layers: [
        'Sign up: a username field that says while you type whether the name is free, plus an age confirmation.',
        'API: unique usernames, an availability check, add-by-username, and emails sent only to admins.',
        'Database: existing accounts got a username derived safely from their email, with no collisions.',
      ],
    },
  },
  {
    date: '2026-10-09',
    area: 'Security',
    title: 'A tamper-evident audit trail',
    brief:
      'Every change in a workspace is recorded in the same transaction, numbered, and chained with SHA-256, so an edited or deleted event is named when the chain is checked. Admins get a security view and an export; an operator can stream the trail to a SIEM over HTTPS, with an idempotency key per event.',
    summary:
      'Every change in a workspace is recorded in the same transaction as the change, numbered, and chained with SHA-256, so an edited or deleted event is named when the chain is checked. Admins get a security view and an export, and an operator can stream the trail to a SIEM over HTTPS.',
    checked:
      'Tests tamper with the trail three ways and verification names each one; a stand-in receiver gets every event exactly once by key after a forced retry through the job queue; a rolled-back change leaves no event.',
    feature: {
      name: 'An audit trail you can check',
      where: 'A workspace, the Activity tab, then Security view. Admins and owners.',
      layers: [
        'Security view: who did what, filtered by person or kind, the chain check, and an export as JSON lines.',
        'API: a paged export and a verify endpoint that names the first broken event.',
        'Database: every change writes its event in the same transaction, numbered and hash-chained, on an append-only table.',
        'Worker: streams the trail to a SIEM over HTTPS, each event carrying an idempotency key.',
      ],
    },
  },
  {
    date: '2026-10-09',
    area: 'Security',
    title: 'Request hardening',
    brief:
      'The API no longer trusts any client to name its own address (`TRUST_PROXY` now defaults to no proxy), every request carries an id from the API through to the ML service, and pages with a token in the link send no referrer and are never cached.',
    summary:
      'The API no longer trusts any client to name its own address, every request carries an id from the API through to the ML service, and pages with a token in the link send no referrer and are never cached.',
    checked:
      'Tests prove a spoofed X-Forwarded-For is ignored by default, an injected id is replaced rather than echoed, and the id reaches a stand-in ML service.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Priority suggestions in the composer',
    brief:
      'Typing an issue title offers a suggested priority with its score, filed only if you press Use. Below 40 triaged issues the model says so instead of guessing.',
    summary:
      'Typing an issue title offers a suggested priority with its score, filed only if you press Use. Below 40 triaged issues the model says so instead of guessing.',
    checked:
      'Route, parser and HTTP client tests, including a non-member who gets a 404 before the model is ever asked.',
    feature: {
      name: 'A suggested priority while you type',
      where: 'A project board, the new-issue composer.',
      layers: [
        'Composer: the suggestion and its score, with Use and Clear; nothing is set until you choose.',
        'API: a triage endpoint behind the same membership check as the board.',
        'ML service: a TF-IDF model trained on the workspace, which declines below 40 triaged issues and says why.',
      ],
    },
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Duplicate detection, measured',
    brief:
      'A labelled set of 84 queries, threshold chosen on one half and reported on the other: precision 0.79, recall 0.62, and none of the 7 duplicates that share almost no words.',
    summary:
      'A labelled set of 84 queries, with the threshold chosen on one half and reported on the other: precision 0.79, recall 0.62, and none of the 7 duplicates that share almost no words.',
    checked:
      'A test keeps the default threshold equal to the one the evaluation chose, so it cannot quietly go back to a guess.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Character n-grams tried, and not adopted',
    brief: 'None of five representations found more reworded duplicates without more false alarms.',
    summary:
      'Five representations compared against a rule fixed in advance. None found more reworded duplicates without more false alarms, so production stays as it was.',
    checked: 'Reproducible with python -m robis_ml.duplicate_eval --compare.',
  },
  {
    date: '2026-10-09',
    area: 'Site',
    title: 'A live landing page',
    brief:
      'The name letter by letter over a WebGL field, and a demo where you cut the network and watch it merge.',
    summary:
      'The name, letter by letter, over a WebGL field that acts each letter out, then a demo where you cut the network, type on both sides and watch it merge.',
    checked: 'The demo runs on real Yjs documents, with tests holding it to "nothing is lost".',
  },
  {
    date: '2026-10-08',
    area: 'Security',
    title: 'An authenticated ML service',
    brief:
      'A token it refuses to start without, and duplicate hints that degrade to nothing when it is down.',
    summary:
      'The ML service needs a token and refuses to start without one. Duplicate hints reach the composer, and a broken service only ever means no hints.',
    checked:
      'Tests for tenant isolation between workspaces and for every way the service can fail.',
    feature: {
      name: 'Possible duplicates while you type',
      where: 'A project board, the new-issue composer.',
      layers: [
        'Composer: similar existing issues appear under the title, with a match percentage and a link.',
        "API: asks the ML service for this workspace's issues only, and shows nothing if it is down.",
        'ML service: TF-IDF similarity behind a service token it refuses to start without.',
      ],
    },
  },
];

export const AREAS: readonly Area[] = ['Product', 'ML', 'Security', 'Site'];
