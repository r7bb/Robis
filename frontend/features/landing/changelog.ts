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
    date: '2026-10-29',
    area: 'Site',
    title: 'One image library, and none in the web app',
    summary:
      'The API resizes uploads with sharp, and the web app used to carry a second copy that Next.js loads to resize pictures on each request. Now there is one version of sharp, the current one, across the repository. The landing’s screenshots are converted to WebP at the size the page shows them, once, before each build, and the web app serves them as they are, so its image no longer holds an image library at all. Each screenshot is about a quarter of the size of the picture it replaces.',
    checked:
      'Tests prove the lockfile resolves sharp to a single version with matching native binaries, that Next is set to serve images as they are, and that the landing asks only for WebP files that each have a source to be made from. The image check now also looks inside the web image: it found sharp there before and finds none after. The API’s image tests pass on the new version, and the full suite passes. On the rebuilt stack every service came up healthy and the stack and browser smoke tests passed.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'Every package lists what it uses',
    summary:
      'The repository’s top level used to install the database driver, the web server, the image library and every one of its own packages, so the tests and scripts worked whether or not anything declared what they used. It now installs only the tools that run across everything: the formatter, the type checker and the runtime’s types. The tests and the scripts are packages of their own that list what they import, and nothing reaches into another package by a relative path.',
    checked:
      'A new test reads every source file in the repository and fails on an import its package does not declare, or a relative import that leaves its package, and checks that the top level holds only the three tools. It found 11 tests reaching into the web app and 2 into the scripts by path, and 19 packages installed at the top level; all are fixed, and planted examples of each mistake are caught. It runs in CI. The full suite passes, every image builds from the locked dependencies, and on the rebuilt stack the image, stack and browser smoke tests passed.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'Each image carries only its own service',
    summary:
      'The API, the live gateway and the worker used to share one dependency install, so every image carried everything any of them needed. Each now installs only its own service’s packages: the gateway and the worker no longer carry the API’s web server or its native image library, and each is about 70 MB smaller. Fewer packages in an image is less to patch and less for a scanner to find.',
    checked:
      'A new check, run in CI right after the images are built, looks inside each image: the gateway and worker images must hold no sharp and no Fastify, and the API image must hold both, which shows the search would find them. It failed on the old images, which carried both, and passes on the new ones. On the rebuilt stack the migrator and seed exited cleanly, every service came up healthy, and the stack and browser smoke tests passed.',
  },
  {
    date: '2026-10-29',
    area: 'Site',
    title: 'No service reaches into another',
    summary:
      'Where uploaded files are kept, on disk or in any S3-compatible store, is now a package of its own that the API and the worker both use. Before, the worker borrowed it from inside the API, so the worker depended on the whole API package, its web server and its image library included. Now no service imports another: the API, the live gateway and the worker share code only through packages made for sharing, so each can be built, deployed and scaled on its own.',
    checked:
      'A new test reads every source file and package manifest of the three services and fails on any import of another service, by package name or by relative path; it failed on the worker before the move and passes after, and a planted example of each kind of import is caught. It runs in CI with the suite. The full suite passes, and on the rebuilt stack the smoke test stored an image in S3 with the worker running from the new package.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'Every workspace has a storage limit',
    summary:
      'Each workspace can now store up to 1 GB of images. An upload that would go past it is refused before any of it is read, with a message saying an owner can make room by deleting old images, so one workspace cannot fill the disk for everyone. Owners see how much is used on the workspace’s tile on the home, as a thin bar in the workspace’s colour with the figures beside it; other members are not shown it.',
    checked:
      'Tests prove an upload goes through while there is room, is refused with 413 and storage_quota_exceeded once the workspace is within a few bytes of its limit, and that someone outside the workspace still gets the usual not found rather than learning its usage; and that the home overview reports usage to owners and nothing to a member. The full suite passes.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'Delete your own account',
    summary:
      'Account settings now let you delete your account yourself. You confirm with your password, and for each workspace you own you choose: hand it to one of its members, who becomes its owner, or delete it with everything in it. Then every session ends, your name, email, username, picture and password are removed, and your picture’s file is deleted; what you wrote in workspaces that stay is kept under “Deleted user”. Your details in the audit trail are erased by the erasure tool’s own account, which the deletion asks for, since the app itself is not allowed to erase. The erasure design is a draft for legal review.',
    checked:
      'Tests prove deletion needs the right password, refuses until every workspace you alone own has a decision, hands a workspace only to a member and makes them owner, deletes a chosen workspace and queues its files for removal, ends every session so the account cannot sign in again, keeps your work under Deleted user, and, once the erasure has run, leaves no column of any table holding your email, name or username. Walked in headless Chrome: a new account signed up, deleted itself from Account, landed on the front page and could not sign in again.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'Erasure has its own key, and leaves a receipt',
    summary:
      'Blanking a person’s details out of the audit trail used to be something the app’s own database account could do. Now only the erasure tool’s own account can, and the app cannot read or write the record of erasures either. Each erasure, done in one step, removes the person’s fields and former usernames and writes a receipt: when it happened, how many records it changed, and a commitment to whom that names nobody on its own. The tool prints a one-time value to keep with the request; with it, the receipt proves which request it answered. The erasure design is a draft for legal review.',
    checked:
      'Tests prove the app’s account is refused any change to the personal fields and any read or write of the erasure record; that the erasure account can erase but its attempt to rewrite rather than blank is refused by the trail’s own trigger, and every other column is out of its reach; and that an erasure blanks every field, records the counts, and stores a commitment that matches the person and the printed value while the record itself contains neither.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'A database account per service',
    summary:
      'The live gateway and the background worker no longer share the app’s database account. Each connects as its own, granted only what its code does: the gateway can check a session and a membership and keep documents in step, and the worker can run its jobs, send its mail and notifications, tidy up expired records and stream the audit trail. Neither can change an issue, a person or a membership, and the worker reads the audit trail without being able to alter it. With the duplicate service’s read-only account, every service now has the narrowest access it can work with.',
    checked:
      'The gateway’s and the worker’s own test suites now run as their accounts, so a grant either needs and lacks fails a test; finding the gaps that way added exactly what compaction, the nudge scan and the audit stream use. New tests prove the gateway is refused changes to issues, people and memberships and any read of the audit trail or the job queue, and the worker is refused changes to issues, people, memberships and the audit trail and any read of document contents. The full suite passes, and on the rebuilt stack the migrator made all four accounts and both smoke tests passed with the services running as them.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'The ML service can read one view, and nothing else',
    summary:
      'The duplicate and priority service used to connect with the same database account as the rest of the app, which could read and change nearly every table. It now has an account of its own that can read one view, made by the migrations, holding only the issue fields its models use: no other table, and no writing at all. A column added to issues later stays out of its reach until someone adds it to the view on purpose. The service’s own notes no longer claim a setting it chooses for itself is enforced by the database.',
    checked:
      'Tests prove the view has exactly the columns the service reads, and that its account can read the view but is refused the issues, users and sessions tables and any change to the view. The service’s 96 Python tests pass against the view, and on the rebuilt stack, running as that account, it still found the duplicate of a seeded issue.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'The whole stack tested as production runs it',
    summary:
      'Every push now also runs the whole container stack in production mode: every service told it is production, the edge proxy serving HTTPS with a throwaway certificate made for that run, mail sent over TLS because plain mail is refused, a fresh signing key for the audit trail, and no demo data. The same end-to-end and browser tests then drive it, so a rule that only applies in production (a Secure host-only cookie, HSTS, an https web address, encrypted mail) is exercised before anything is deployed, not first discovered after.',
    checked:
      'Run locally and added to CI: the stack came up healthy in production mode behind HTTPS; the end-to-end test signed up from the emailed link (which the worker could only send over TLS), checked the session cookie is the __Host- one, joined the live socket, created an issue and uploaded an image; and the browser test loaded every page with no security policy violation. The development stack is unchanged and still tested first.',
  },
  {
    date: '2026-10-29',
    area: 'Security',
    title: 'One address for the whole app',
    summary:
      'The web app, the API and the live gateway now sit behind one address: an edge proxy serves the app at /, the API at /api and the gateway at /ws. The web app holds no addresses of its own, so one built image runs anywhere, and a production build that points at localhost is refused. With one origin the API no longer tells any other site it may read its answers, and only the proxy is reachable from outside; the API, gateway and everything behind them are on the private network. A new deployment guide sets out the layout and how many database connections each service needs.',
    checked:
      'Tests prove a production build refuses a localhost API or gateway address and accepts relative or real ones, and that no API response or preflight grants another site access. The stack smoke test signed up, joined the live socket over /ws, created an issue and uploaded an image, all through the proxy, and the browser smoke test loaded every page under the security policy through it.',
  },
  {
    date: '2026-10-23',
    area: 'Product',
    title: 'A live river of your team’s two weeks',
    summary:
      'The signed-in home has a picture of its own now, instead of the landing page’s field: two weeks of your team’s activity as a river, one band per workspace in its theme’s colour, stacked, so you can see when the team was busy and where. Hover a day for each workspace’s count; when a teammate changes something, a ripple goes out from today’s edge of that workspace’s band. Behind it, an aurora in the colours of the time of day. Rising numbers show a small +1, tiles lean toward the pointer, feed lines carry their workspace’s colour and assigned issues their status colours. The demo has three workspaces in three themes. Still under reduced motion.',
    checked:
      'Tests prove the river stacks each workspace on the ones before it, that its curves never dip below zero or rise above the peak, and the palette for each part of the day. Headless Chrome watched a teammate’s change arrive live and checked the phone layout, reduced motion and the security policy. The demo seed adds the two new workspaces to an existing demo account without touching anything else, and a full reseed now only deletes workspaces the demo accounts created.',
  },
  {
    date: '2026-10-23',
    area: 'Product',
    title: 'A live home after you sign in',
    summary:
      'The page you land on after signing in used to be a plain list of workspace names. Now it greets you over the same moving field of points as the landing page, and that field reacts to your own workspaces: every change a teammate makes sends a ring across it, it quickens while someone else is here and greys if the connection drops. Below it, the open issues assigned to you, a live feed of what is happening, and a tile for each workspace with its open issues, two weeks of activity, who is in it and who is here right now, and what happened last. Tiles pulse when their workspace changes, and the numbers count to their new values. Everything is still under reduced motion, works from the keyboard and fits a phone.',
    checked:
      'Tests prove the new overview counts open issues and two weeks of activity, lists the open issues assigned to you newest first with the true total beyond five, names the latest action without a comment’s text, and includes only workspaces you are in, even if an issue there is still assigned to you after you leave. Headless Chrome signed in as the demo owner, watched a teammate open an issue from another session arrive in the feed and pulse its tile, and checked the phone layout, reduced motion and that the page raises no security policy violation; the browser smoke test in CI now loads it too.',
  },
  {
    date: '2026-10-23',
    area: 'Security',
    title: 'One configuration loader that fails closed',
    summary:
      'The API, the realtime gateway, the worker and every command-line tool now read their settings through one loader with one set of rules. The environment must be named; nothing guesses. In production nothing falls back to a local default: a missing database address or web address, or a web address that is not https, stops the service at start-up with every problem listed, instead of quietly connecting to localhost or mailing links nobody can open. Before, the command-line tools fell back to a local database even in production, and the gateway to a local web address.',
    checked:
      'Tests prove the loader refuses an unset environment, uses local defaults only outside production, refuses a missing or plain-http web address and a missing database in production, requires the owner’s own address for migrations in production and refuses a service given only that one, never repeats a rejected web address (it may hold a password), and reports every problem at once. Every entry point, the API, gateway, worker and five command-line tools, is started in production with no database and must refuse, naming it; the five tools did not before. Each runs without the developer’s own .env file, so it cannot supply the answer.',
  },
  {
    date: '2026-10-23',
    area: 'Site',
    title: 'The demo account is ready in the container stack',
    summary:
      'Starting the container stack now creates the demo accounts, so it can be tried without signing up: rohit@robis.test, password robis-demo-password, owner of an Engineering workspace with projects, issues, channels and a team of three. The demo people start with a confirmed address and a picture, so signing in goes straight to the workspace. It happens once: later starts leave the accounts and anything changed in them alone. The demo password is refused in production, as before.',
    checked:
      'On the rebuilt stack, the seed ran on first start and reported four people, two projects and ten issues; a second start reported the owner already there and changed nothing; and in headless Chrome, signing in through the form as rohit@robis.test landed in the Engineering workspace as owner, with no welcome screen. The stack and browser smoke tests and the CI health check, which now expects the seed to have exited cleanly, all pass.',
  },
  {
    date: '2026-10-23',
    area: 'Security',
    title: 'A strict security policy for every page',
    summary:
      'Every page now carries a Content-Security-Policy that runs only the scripts the server stamped with a fresh one-time value, so a script or event handler slipped into a page cannot run. Nothing may show Robis inside a frame, which stops clickjacking. Browsers are told to use HTTPS only, the camera is allowed for Robis itself (the welcome screen takes a picture) and every other powerful feature, such as the microphone and location, is turned off. The sign-up page now gets the same no-referrer, no-store treatment as the reset and verification pages, and the offline cache never keeps a page carrying a one-time link. Next.js is now on 15.5.28, which fixes a critical flaw in image optimisation.',
    checked:
      'Tests pin the policy: scripts only by nonce with strict-dynamic, no unsafe-inline or eval outside development, frame-ancestors none, connections only to the app, the API and the gateway, the camera for this origin only, and HSTS in production only, for this host; and that every API response forbids running script, framing and sniffing. A new browser smoke test, run in CI against the container stack, loads the landing, sign-in, sign-up, intro, How it works and What’s new pages and a signed-in workspace in Chrome and fails on any policy violation; it found zod probing for eval, now switched off in the browser. It also serves a page with a script and an onclick handler injected into its HTML, as a stored cross-site script would be, and checks that neither runs and both are reported. It also checks each response has a fresh nonce matching its scripts, that the WebGL landing is drawing with its own program, that a signed-in workspace stays clean once its API calls and socket have run, and, in a separate Chrome check, that the offline cache keeps the sign-in page but not a sign-up link.',
  },
  {
    date: '2026-10-23',
    area: 'Security',
    title: 'Sign up with your email first',
    summary:
      'Creating an account used to say “an account with that email already exists”, which let anyone check whether an address was registered. Now sign-up starts with just your address and always answers “check your inbox”, after the same short wait either way. A new address gets a link that finishes signing up, where you choose your name, username and password; an address that already has an account gets a reminder to sign in instead, so only whoever reads that inbox learns which it was. The link works once, for 24 hours, and opening it confirms your address, so a new account starts confirmed and can join workspaces at once. Asking again sends another link without cancelling the first, the link is taken out of the address bar once the page has read it, and a sign-up nobody finishes is cleared away a week after its link runs out.',
    checked:
      'Tests prove starting a sign-up answers the same status and body for a new address and a registered one, mails a finishing link to the first and a reminder without a link to the second, is limited per address, and refuses something that is not an address; that the link creates a confirmed account with the consent recorded, works once, expires, is not cancelled by someone asking again for the same address, makes one account when two finishes race with it, and survives a refused username; that unfinished sign-ups are swept a week after their link runs out while recent ones stay; and that a second sign-up for a registered address in any letter case makes no account. Every other suite now signs people up the same way. The stack smoke test signs up from the link the worker actually mailed, and the form was walked in headless Chrome from address to inbox to finished account, and at phone width, checking the link leaves the address bar and the form still finishes.',
  },
  {
    date: '2026-10-20',
    area: 'Security',
    title: 'Email invitations that give nothing away',
    summary:
      'Inviting someone by email used to say “no account exists with that email”, which let anyone with a workspace check whether an address was registered. Now an email invitation answers the same whether or not the address has an account, the same email goes to it either way, and the pending list shows the address as typed, never who it turned out to be. Whoever owns the address sees the invitation once their address is confirmed, including someone who signs up later. The cap on unanswered invitations now counts per sender, so a stranger with throwaway workspaces cannot fill anyone’s and block a real team, and a reserved name spelled with a 1 for an i, such as adm1n, is refused.',
    checked:
      'Tests prove an invitation to an address with an account and one without answer with the same status and body, send the same email and show alike in the pending list; that an unconfirmed account does not see an email invitation and a confirmed one can accept it; that a later sign-up with the address sees it; that inviting a member’s address changes nothing and says the same; that twelve strangers with throwaway workspaces cannot block a real invitation while one sender with 50 waiting is refused the next; and that adm1n is reserved while 1ndex is not.',
  },
  {
    date: '2026-10-20',
    area: 'Security',
    title: 'Safer by default before going live',
    summary:
      'A review before deployment tightened the defaults. The API, the live feed, the worker and the command-line tools now refuse to start unless they are told whether they are in development, test or production, instead of assuming development. In production the session cookie is always Secure and carries the __Host- prefix, so no other subdomain or plain-http page can set it. Writes from another website are refused before they are read, the same check the live feed already made. Metrics moved to an internal port, while the health check stays public. A session unused for 7 days now ends, within the 30 it can live, and deleting a workspace asks for your password.',
    checked:
      'Tests prove each service and tool refuses to start without NODE_ENV and with an unknown one; that a production sign-up sets a Secure __Host- cookie even with COOKIE_SECURE=0, and that it is the cookie recognised; that a write with another site’s Origin or a cross-site Sec-Fetch-Site is refused while the web app’s own origin, same-site and tools without browser headers are not, and reads are not touched; that /metrics answers 404 on the public port and is served on its own; that a session unused for 8 days is refused and one used 6 days ago is not; and that deleting a workspace without the password, or with a wrong one, deletes nothing.',
  },
  {
    date: '2026-10-20',
    area: 'Security',
    title: 'Asked again when the terms change',
    summary:
      'Sign-up now keeps when you confirmed your age and which version of the terms you agreed to. When the terms change, you are asked again before you go back into a workspace, and the server holds the line the same way it does for a profile picture: workspace pages, the live feed and the inbox wait for an answer, while your account and the way out of a workspace stay open. Accounts whose username was given to them rather than chosen are asked once to keep it or pick their own. The terms, the privacy notice and the minimum age are drafts for legal review.',
    checked:
      'Tests prove sign-up stores the age confirmation time and the terms version, that a page showing old terms cannot sign anyone up, that an account on old terms is refused workspace routes (403) and the live feed until it agrees, that agreeing is in your own account history with the version, that agreeing to anything but the current version is refused, that leaving a workspace never needs an answer while accepting an invitation does, that a sign-up which does not say what it showed is asked on first visit, that answering again changes nothing, and that keeping or changing a given username both count as confirming it. Walked through in headless Chrome against the containers rebuilt from this code: an account on old terms sent to the question, then its username, then back where it was going, and at phone width. A security review found sign-up writing no history entry and repeat answers overwriting the first; both are fixed.',
  },
  {
    date: '2026-10-16',
    area: 'Product',
    title: 'Invitations you answer',
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
    summary:
      'Lookalike usernames now count as the same name: dots and underscores are ignored, 0 reads as o and 1 as l, so ada.l, ada_l and adal cannot all exist, and neither can b0b beside bob. A username you let go is held for 90 days, and only you can take it back; an account can hold three old names at once, so nobody can sit on a list of them. Every mention is tied to the person it meant when the comment was written, so if Bob renames and someone else later takes his old name, old comments still point at Bob, show his new name beside the old one, and notify only him.',
    checked:
      'Tests prove the code and the database derive the same key, that sign-up, renames and the availability check all refuse lookalikes and held names, that the owner can take a held name back, that a fourth hold is refused, that a sign-up racing a rename never gets the released name (both names are locked during a rename), that a hold ends after 90 days and is swept, that erasing a person forgets their old names but keeps the hold, that a rename is in your own account history without the names, and that a mention written before a rename still points at the right person. The migration was applied to a scratch database holding colliding names; the earliest account kept its name, the others got the lowest free suffix, and an old comment’s mention of a renamed account still found it. Reviewed for correctness, security and the database; the rename race and the hold cap came from those reviews.',
  },
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
