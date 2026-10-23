# Robis

A collaborative workspace that keeps working when the network does not.

Issues, documents, chat and meetings for a team. Every change you make offline
is queued locally and reconciles when you reconnect, exactly once.

![The Robis workspace](imgs/03-workspace.png)

```bash
bun install
bun run db:start && bun run db:migrate && bun run db:seed -- --team

bun run dev:api        # :4000
bun run dev:realtime   # :4001
bun run dev:worker
bun run dev:web        # :3000
```

Sign in as `rohit@robis.test` with `robis-demo-password`.

## What's new

Newest first. The same list is the site's What's new page, linked from the
header, where each entry opens to show how it was checked and, for features,
where to find it and what each layer does.

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

What comes next is in [docs/PLATFORM_PLAN.md](docs/PLATFORM_PLAN.md).

> **Behind a proxy, set `TRUST_PROXY`.** It defaults to trusting no proxy,
> which is right when the API faces clients directly. Behind a load balancer
> left unset, every client appears to come from the proxy's address and
> shares one rate-limit bucket. Set the number of trusted hops (`1` for one
> proxy) or the proxy's addresses, and keep the API port unreachable except
> through that proxy.
>
> **Streaming the audit trail to a SIEM.** Set `AUDIT_STREAM_URL` (https, or
> http to localhost only) and optionally `AUDIT_STREAM_TOKEN` for the worker.
> It POSTs `{ "source": "robis", "events": [...] }` in batches of up to 100
> and moves on only after a 2xx. Delivery is at-least-once: after a lost
> response the batch is sent again, so deduplicate on each event's `key`.

---

## What it does

**Chat in channels.** Workspace rooms with history, moderation, and the same
permission rules as everything else.

**Documents that merge.** Two people can type in the same paragraph. Yjs CRDTs
over a WebSocket gateway, so edits converge without a lock and without losing a
keystroke.

![Two people editing one document](imgs/08-document-collab.png)

**Issues on a board.** Projects, statuses, priorities, assignees, comments with
`@mentions`, and a full audit trail.

![The issue board](imgs/04-board.png)

**Meetings.** Schedule, invite, answer. Moving the time clears everyone else's
yes, because a yes was for a time.

![The meetings panel](imgs/28-meetings.png)

**Search across everything.** Issues, documents and comments, through Postgres
full-text search.

![Search](imgs/18-search.png)

**An audit trail you can check.** Every change is written in the same
transaction as the change itself, so a rolled-back edit leaves no event. Each
workspace's events are numbered 1, 2, 3 and chained: every event stores a
hash of itself and of the one before, signed with a key the database never
holds. The app connects as a database role that can add audit events but
never change or remove them. Admins open **Security** from
the Activity tab to see who did what, filter it, check the chain, and export
it as JSON lines. Edit a row behind the app's back and the check names the
event and says how it was changed. Reading, exporting and checking the
trail are recorded in it too, and checks start where the last one ended,
from a checkpoint stored with a signature, so they stay quick as the trail
grows; a full check walks every event again.

What it does not catch on its own: someone with database access who rewrites
every event from the edit onwards, or drops the newest ones. That is what an
outside copy is for — the head hash shown in the security view, or the SIEM
stream below.

---

## Works offline

Pull the network out mid-sentence. Writes land in a durable queue in IndexedDB
and the board keeps working.

![Offline, with unsynced changes](imgs/06-offline-unsynced.png)

On reconnect the queue drains in order. A server-side ledger keyed by a
client-generated id means a retry after an ambiguous failure cannot create the
same issue twice.

![After reconnecting](imgs/07-after-reconnect.png)

---

## Measured, not estimated

From the load harness in this repository (`bun run loadtest`), on one laptop
with Postgres on the same machine.

| Operation             | p50    | p95     | p99     |
| --------------------- | ------ | ------- | ------- |
| Read (list 25 issues) | 6.4 ms | 8.1 ms  | 9.6 ms  |
| Write (create issue)  | 9.8 ms | 11.8 ms | 13.5 ms |

**~4,400 requests/second, zero errors.** A write reaches all 50 subscribed
clients in 5.8 ms at p50.

---

## How it is put together

```text
frontend/        Next.js 15, React 19, Tailwind
backend/
  api/           Fastify HTTP API
  realtime/      Bun WebSocket gateway: fan-out, presence, document rooms
  worker/        background jobs
  auth/          Argon2id passwords, opaque sessions
  database/      Drizzle schema and migrations
  mailer/        mail port plus drivers
  metrics/       Prometheus registry
shared/
  contracts/     Zod schemas, the permission matrix, wire events
  sync/          offline queue, CRDT glue
robis-ml/        duplicate detection and priority triage (Python)
```

`shared/` is a third top-level directory rather than a folder inside
`backend/`, because the frontend genuinely imports it: `@robis/shared` and
`@robis/sync` are its only two workspace dependencies. Filing them under the
backend would misdescribe who uses them. The package is still named
`@robis/shared`; the directory is `contracts` because that is what is in it.

Four roles, one declarative permission matrix. Non-members get **404, not
403** — a 403 confirms the workspace exists, which is half of what an attacker
wants.

### A few decisions, and why

| Choice                    | Instead of     | Because                                                                                                          |
| ------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Postgres `LISTEN/NOTIFY`  | Redis pub/sub  | The event publishes in the same transaction as the write, so an event cannot exist for a change that rolled back |
| Postgres `SKIP LOCKED`    | a queue broker | Jobs enqueue transactionally with the work that causes them. One fewer service to run                            |
| Keyset pagination         | `OFFSET`       | `OFFSET` re-counts every page and shifts under concurrent inserts, so readers skip rows and see others twice     |
| Opaque sessions           | JWTs           | A session dies the moment a password changes. A signed token stays valid until it expires                        |
| Postgres full-text search | Elasticsearch  | A stored generated `tsvector` cannot drift from the row it describes                                             |

Several of these are also "one fewer thing to run on a laptop with no Docker".
That constraint is real and is stated rather than dressed up.

The long version, with the rejected alternatives spelled out, is in
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

---

## Machine learning

`robis-ml/` finds possible duplicate issues and suggests a priority. Both are
advisory; nothing acts on a prediction.

TF-IDF rather than transformer embeddings, because one workspace's issues are
short and full of shared project vocabulary. The limitation is documented
honestly: "auth" matches at 0.64 where "authentication" matches at 0.26 for the
same intent. Below 40 triaged issues the model **declines to predict** rather
than returning a confident-looking guess.

It sits behind a shared service token and is wired into the issue composer:
typing a title shows possible duplicates and a suggested priority. If the service is missing, slow or
broken, the hints disappear and filing still works.

Duplicate detection is measured against a small labelled set, with the
threshold chosen on one half and reported on the other. It catches most
reworded duplicates and **none of the 7 that share almost no words** with the
original. The set was written by the author, so these are not production
figures. See **[robis-ml/README.md](robis-ml/README.md)**.

---

## Commands

| Command               | What it does                                   |
| --------------------- | ---------------------------------------------- |
| `bun test`            | the suite; counts in the roadmap               |
| `bun run typecheck`   | every package                                  |
| `bun run lint`        | Biome                                          |
| `bun run loadtest`    | the benchmark above                            |
| `bun run screenshots` | recapture every image in this README           |
| `bun run db:reset`    | drop and recreate the dev database             |
| `bun run db:roles`    | create the app's runtime database role         |
| `bun run audit:seal`  | sign audit trails from before signing, once    |
| `bun run audit:erase` | erase a person's fields from the trail (draft) |
| `bun run mail:start`  | local mail inbox, SMTP on port 1025            |
| `bun run smoke:stack` | drive a running container stack                |

A deployment runs migrations and `db:roles` as the database owner
(`MIGRATION_DATABASE_URL`), and the services as the runtime role
(`DATABASE_URL`, user `robis_app`, password `APP_DB_PASSWORD`), which can add
audit events but not change them. Locally the owner works for everything;
to run as the role, set
`DATABASE_URL=postgres://robis_app:robis_app_development@localhost:5433/robis`
after `bun run db:roles`. The tests always run as the role. Outside
development the audit trail needs a signing key in `AUDIT_HMAC_KEYS`
(`<id>:<base64 of 32+ random bytes>`). Upgrading a database whose trail
predates signing: deploy, then run `bun run audit:seal` once, with the same
key, to sign every old chain.

The whole stack also runs from its container images:

```bash
docker compose -f deploy/compose.yaml up --build --wait
bun run smoke:stack
bun run smoke:browser
```

The images are in [deploy/docker](deploy/docker). The stack serves plain
http on 127.0.0.1, so its services run in development mode. Set
`STACK_WEB_PORT` if port 3000 is taken.

The stack seeds the demo accounts on its first start, so there is nothing
to create: open <http://localhost:3000> and sign in as `rohit@robis.test`
with `robis-demo-password`, owner of the Engineering workspace (Alex, John
and Mia sign in the same way, as admin, member and guest). Later starts
leave the accounts and anything changed in them alone.

To send real mail, give the worker `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS` and `MAIL_FROM` (`SMTP_SECURE=true` for port 465). Locally,
`SMTP_HOST=127.0.0.1 SMTP_PORT=1025` sends to `bun run mail:start`, whose
inbox is at <http://127.0.0.1:8025>. With no `SMTP_HOST`, mail is printed to
the worker's log.

Every screenshot here is produced by that script driving a real Chrome against
the real stack. None of them is a mockup.

---

## Status

A portfolio project, built to be read. It runs locally and is tested. It has
not been deployed. Every service has a container image, built, started,
driven end to end and scanned by CI on every push (the `containers` job),
and the same stack has been run on the development machine. Uploads work on local disk or any S3-compatible store;
the S3 driver is tested in CI against S3Mock, not against a cloud provider.
Mail goes out over SMTP, tested against a local SMTP server, not a real
provider, and nothing here says whether a given provider will deliver it.
The API and the worker **refuse to start in production** with no mail driver
configured rather than print reset links into a log.

Nothing here is a security or compliance claim. It describes what the code does
and what was measured.

The audit trail is built to outlive the accounts it names. New member events
record a username rather than an email or real name, kept beside the hashed
trail so `bun run audit:erase -- <user id>` can remove it while the chain
still verifies. That erasure is a technical design marked for legal review,
not a claim about any law. Events written before it hold their username,
or before usernames their email, inside the hashed payload, where erasing
it would break the chain. How long to keep the
trail, and how that sits with a request to erase someone's data, needs a
legal review before any real users. The terms and privacy pages are drafts
for the same review, and the minimum age (16) is a placeholder. What each
account agreed to is stored (the age confirmation, the terms version and
when), and so is its answer when the terms change; how long those records
are kept is part of the same review.

What is next is in **[docs/ROADMAP.md](docs/ROADMAP.md)**.
