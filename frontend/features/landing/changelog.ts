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
export type Feature = {
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
  summary: string;
  /** How it is known to work: tests, measurements, or what was verified. */
  checked: string;
  /** Present only when the entry ships something usable end to end. */
  feature?: Feature;
};

export const CHANGELOG: readonly Entry[] = [
  {
    date: '2026-10-16',
    area: 'Site',
    title: 'A short tour before you sign up',
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
    summary:
      'The app now connects to the database as a role that can add audit events but never change, remove or empty them, and cannot switch off the trigger that guards them. New events are signed with a key kept outside the database, recorded by id so keys can rotate.',
    checked:
      'Tests run the whole suite as that role, and prove it is refused an edit, a removal and emptying the table even with the trigger switched off. A row re-hashed without the key, the tail of a chain rewritten unsigned, a whole chain rewritten unsigned and an empty key id are each caught, and older events still verify after a key rotation. Deleting a workspace leaves a tombstone the role cannot touch, and the stream cursor only moves forward. The container stack runs as the role too.',
  },
  {
    date: '2026-10-15',
    area: 'Site',
    title: 'Every service as a container, checked on every push',
    summary:
      'The web app, API, realtime gateway, worker and ML service each have a container image, and one compose file runs them together with Postgres, object storage and a mail catcher. CI builds every image, starts the stack, and drives it the way a new person would.',
    checked:
      'On every push, CI waits for every health check, then signs up, confirms the address from the email the worker sent, creates a workspace and an issue, watches it arrive over the WebSocket, and attaches an image to object storage. It boots the API and worker in production mode to show they refuse to start without mail, and fails on any critical vulnerability in an image that has a fix. All of it was also run on the development machine.',
  },
  {
    date: '2026-10-13',
    area: 'Product',
    title: 'Reset and confirmation emails over real mail',
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
    summary:
      'The seeded accounts share a password printed in the README. Outside development the API refuses it at sign-in, sign-up, password change and reset, and the seed script will not run against production at all.',
    checked:
      'Tests prove signing in with it fails exactly like a wrong password, each way of setting it is refused, a refused reset does not spend the link, and a development app still accepts it.',
  },
  {
    date: '2026-10-13',
    area: 'Product',
    title: 'Images on issues and comments',
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
    summary:
      'The architecture guide pointed at folders that no longer existed and four documents quoted four different test counts. Every link now resolves, counts live in one place, and CI checks both on every push.',
    checked:
      'A link checker runs in CI over every Markdown file and over the paths the app inventory names; a second CI step runs it on a fixture with a known broken link and requires it to fail.',
  },
  {
    date: '2026-10-13',
    area: 'Product',
    title: 'A picture before you start',
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
    summary:
      'The API no longer trusts any client to name its own address, every request carries an id from the API through to the ML service, and pages with a token in the link send no referrer and are never cached.',
    checked:
      'Tests prove a spoofed X-Forwarded-For is ignored by default, an injected id is replaced rather than echoed, and the id reaches a stand-in ML service.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Priority suggestions in the composer',
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
    summary:
      'A labelled set of 84 queries, with the threshold chosen on one half and reported on the other: precision 0.79, recall 0.62, and none of the 7 duplicates that share almost no words.',
    checked:
      'A test keeps the default threshold equal to the one the evaluation chose, so it cannot quietly go back to a guess.',
  },
  {
    date: '2026-10-09',
    area: 'ML',
    title: 'Character n-grams tried, and not adopted',
    summary:
      'Five representations compared against a rule fixed in advance. None found more reworded duplicates without more false alarms, so production stays as it was.',
    checked: 'Reproducible with python -m robis_ml.duplicate_eval --compare.',
  },
  {
    date: '2026-10-09',
    area: 'Site',
    title: 'A live landing page',
    summary:
      'The name, letter by letter, over a WebGL field that acts each letter out, then a demo where you cut the network, type on both sides and watch it merge.',
    checked: 'The demo runs on real Yjs documents, with tests holding it to "nothing is lost".',
  },
  {
    date: '2026-10-08',
    area: 'Security',
    title: 'An authenticated ML service',
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
