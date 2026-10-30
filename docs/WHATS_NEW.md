# What's new

Newest first. The same list is the site's What's new page, where each entry
opens to show how it was checked and, for features, where to find it and
what each layer does. Back to the [README](../README.md).

- **Routes described once, a group at a time** (2026-10-29). One
  definition per route types the API, the web app and a generated
  [OpenAPI document](openapi.json); 60 routes so far, all but the
  account ones, 21 to move.
- **The database library is current** (2026-10-29). Drizzle 0.38 to 0.45,
  with error codes read through its new error wrapping.
- **CI installs exactly what is locked, and runs the Python tests**
  (2026-10-29). Frozen installs, a Python 3.11 job from a hashed lock, and
  caching for downloads and image layers.
- **One image library, and none in the web app** (2026-10-29). One sharp
  version across the repository; the landing's screenshots are WebP made at
  build, and the web image carries no image library.
- **Every package lists what it uses** (2026-10-29). The top level installs
  only tooling; the tests and scripts are packages that declare their
  imports, checked in CI.
- **Each image carries only its own service** (2026-10-29). The gateway
  and worker images no longer hold the API's web server or image library,
  and CI checks each image after building it.
- **No service reaches into another** (2026-10-29). File storage is a
  package of its own, the worker no longer depends on the API, and a test
  in CI refuses any import from one service into another.
- **Every workspace has a storage limit** (2026-10-29). Each workspace can
  store up to 1 GB of images; an upload past it is refused before it is
  read, and owners see the usage on the home.
- **Delete your own account** (2026-10-29). Delete your account from Account
  settings, with your password and a choice for each workspace you own;
  your details are removed and your work stays under "Deleted user".
- **Erasure has its own key, and leaves a receipt** (2026-10-29). Only `audit:erase`'s own account can
  blank the audit trail's personal fields, and each erasure records counts
  and a commitment, never the person.
- **A database account per service** (2026-10-29). The gateway and the worker each connect
  as their own database account, granted only what their code does.
- **The ML service can read one view, and nothing else** (2026-10-29). The duplicate and priority
  service has a database account that can read one view of issue fields,
  owned by the migrations, and nothing else.
- **The whole stack tested as production runs it** (2026-10-29). CI now also runs the stack in
  production mode: HTTPS through the proxy with a throwaway certificate,
  mail over TLS, a fresh audit key and no demo data, driven by the same
  end-to-end and browser tests.
- **One address for the whole app** (2026-10-29). The app, the API and the live gateway share
  one address behind an edge proxy: one web image runs anywhere, a
  production build pointing at localhost is refused, and no other site is
  allowed to read the API. See [DEPLOY.md](DEPLOY.md).
- **A live river of your team’s two weeks** (2026-10-23). Two weeks of activity as a river, one band per workspace in
  its colour; hover a day for counts, and each live change ripples from today.
- **A live home after you sign in** (2026-10-23). The first page after
  signing in now greets you over the landing's field of points, which
  ripples with your teammates' changes, and shows what is assigned to you,
  a live feed, and a tile per workspace with its open issues, activity and
  who is here now.
- **One configuration loader that fails closed** (2026-10-23). Every
  service and command-line tool reads its settings the same way, and in
  production a missing database or web address, or a plain-http one,
  stops it at start-up instead of falling back to localhost.
- **The demo account is ready in the container stack** (2026-10-23). The
  stack now seeds `rohit@robis.test` (password `robis-demo-password`) as
  owner of a populated workspace, with a confirmed address and a picture,
  so it can be tried without signing up.
- **A strict security policy for every page** (2026-10-23). Pages run only
  scripts the server stamped for that response, so injected script cannot
  run; nothing may frame Robis; HTTPS is pinned in production; and only the
  camera is allowed, for Robis itself. A browser test in CI loads the real
  pages and fails on any violation.
- **Sign up with your email first** (2026-10-23). Creating an account now
  starts with just your address and always says "check your inbox", so the
  form never reveals who already has an account. The link in that email
  finishes signing up, works once for 24 hours, and confirms your address
  as it does. Asking again never cancels a link already sent.
- **Email invitations that give nothing away** (2026-10-20). Inviting by
  email answers the same whether or not the address has an account, sends
  the same email either way, and the pending list shows the address as
  typed. Whoever owns the address sees the invitation once it is confirmed.
  The cap on unanswered invitations now counts per sender, so throwaway
  workspaces cannot block a real one, and a reserved name spelled with a 1
  for an i (adm1n) is refused.
- **Safer by default before going live** (2026-10-20). Every service
  refuses to start without being told which environment it is in. In
  production the session cookie is always Secure and host-only. Writes from
  another site are refused. Metrics moved off the public port. A session
  unused for 7 days ends, and deleting a workspace asks for your password.
- **Asked again when the terms change** (2026-10-20). Sign-up now keeps
  when you confirmed your age and which version of the terms you agreed
  to. When the terms change, you are asked again before you go back into a
  workspace. Accounts whose username was given to them are asked once to
  keep it or pick their own.
- **Invitations you answer** (2026-10-16). Adding someone to a workspace
  now sends them an invitation. It shows in their inbox and on their
  workspaces page, and nothing joins their list until they accept. Joining
  needs a confirmed email address; admins see who has not answered and can
  withdraw an invitation.
- **A username nobody else can wear** (2026-10-16). Lookalike names
  (`ada.l` and `ada_l`, `b0b` and `bob`) count as the same name. A name
  you let go is held for 90 days, and only you can take it back. A mention
  points at the person it meant when it was written, so an old `@name`
  never reaches whoever takes that name later.
- **A short tour before you sign up** (2026-10-16). Get started opens six
  slides of their own first: sourced quotes from Grace Hopper, Eisenhower and
  Fred Brooks, a messy desk to sort into a board, a tunnel where notes wait
  for signal, what signing up asks for, then the form, over a loom of slow
  threads. A two-finger trackpad swipe turns the slide.
- **Your own sign-in history, and a way to erase someone** (2026-10-15).
  Account settings show your sign-ins, failed attempts, password changes and
  sessions signed out, signed and seen only by you. Member events keep
  usernames beside the trail, so a person can be erased without breaking
  the chain (a design, for legal review).
- **An audit trail that records who reads it** (2026-10-15). Reading,
  exporting and checking the trail are events in it, and a link on another
  site cannot add one in an admin's name. Checks start from a signed
  checkpoint, so they stay quick, with a full check one click away, and the
  who filter lists former members by username.
- **An audit trail the database cannot quietly rewrite** (2026-10-15). The
  app connects as a role that can add audit events but not change, remove
  or empty them, and new events are signed with a key kept outside the
  database. A rewrite without the key is caught, even of a whole chain.
- **Every service as a container, checked on every push** (2026-10-15).
  Images for the web app, API, gateway, worker and ML service, and one
  compose file that runs them with Postgres, object storage and a mail
  catcher. CI builds them, waits for every health check, drives the stack
  end to end, and fails on fixable critical vulnerabilities.
- **Reset and confirmation emails over real mail** (2026-10-13). Password
  resets and address confirmations go out over SMTP, sent by the worker so a
  slow mail server never slows a request. Failed sends retry, then stay
  visible as dead letters. `bun run mail:start` runs a local inbox.
- **The demo password works only in development** (2026-10-13). Outside
  development the API refuses the README's demo password everywhere, and the
  seed script refuses to run against production.
- **Images on issues and comments** (2026-10-13). Attach a photo, take one
  with the camera, or paste a screenshot. Images are stripped of metadata,
  screenshots stay lossless, and only members can open them. One added with
  no network waits on the device and uploads exactly once on reconnect.
  Storage is local disk or any S3-compatible store, and deleting an issue,
  comment or workspace removes its files.
- **Documentation that agrees with the code** (2026-10-13). Every relative
  link in every Markdown file resolves, test counts live in one place (the
  roadmap), and CI checks both on every push, including proving the check
  fails on a deliberately broken link.
- **A picture before you start** (2026-10-13). New members upload a photo,
  take one with the camera, paste a screenshot or pick a generated pattern
  before using a workspace; the API and the live feed hold that line too.
  Photos are re-encoded with all metadata removed, location included, and
  are shown only to people who share a workspace.
- **Usernames** (2026-10-09). Everyone picks an `@username` at sign-up;
  teammates add and mention each other by it. Email addresses are shown only
  to workspace admins, and the audit trail names people by username, not
  email. Sign-up now asks for an age confirmation and links draft terms and
  privacy pages, both marked for legal review.
- **A tamper-evident audit trail** (2026-10-09). Every change in a workspace
  is recorded in the same transaction, numbered, and chained with SHA-256,
  so an edited or deleted event is named when the chain is checked. Admins
  get a security view and an export; an operator can stream the trail to a
  SIEM over HTTPS, with an idempotency key per event.
- **Request hardening** (2026-10-09). The API no longer trusts any client to
  name its own address (`TRUST_PROXY` now defaults to no proxy), every
  request carries an id from the API through to the ML service, and pages
  with a token in the link send no referrer and are never cached.
- **Priority suggestions in the composer** (2026-10-09). Typing an issue
  title offers a suggested priority with its score, filed only if you press
  Use. Below 40 triaged issues the model says so instead of guessing.
- **Duplicate detection, measured** (2026-10-09). A labelled set of 84
  queries, threshold chosen on one half and reported on the other: precision
  0.79, recall 0.62, and none of the 7 duplicates that share almost no words.
- **Character n-grams tried, and not adopted** (2026-10-09). None of five
  representations found more reworded duplicates without more false alarms.
- **A live landing page** (2026-10-09). The name letter by letter over a
  WebGL field, and a demo where you cut the network and watch it merge.
- **An authenticated ML service** (2026-10-08). A token it refuses to start
  without, and duplicate hints that degrade to nothing when it is down.

What comes next is in [PLATFORM_PLAN.md](PLATFORM_PLAN.md).
