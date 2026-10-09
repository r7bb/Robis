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

Newest first. The same list is on the landing page, where each entry opens to
show how it was checked.

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

```
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

| Choice                    | Instead of     | Because                                                                                                         |
| ------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
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

| Command               | What it does                         |
| --------------------- | ------------------------------------ |
| `bun test`            | over 460 tests                       |
| `bun run typecheck`   | every package                        |
| `bun run lint`        | Biome                                |
| `bun run loadtest`    | the benchmark above                  |
| `bun run screenshots` | recapture every image in this README |
| `bun run db:reset`    | drop and recreate the dev database   |

Every screenshot here is produced by that script driving a real Chrome against
the real stack. None of them is a mockup.

---

## Status

A portfolio project, built to be read. It runs locally and is tested. It has
not been deployed, and three things are missing because this machine has no
Docker and no SMTP: file uploads, a verified container build, and a production
mail driver. The API **refuses to start in production** without a mail driver
rather than printing reset links into a log.

Nothing here is a security or compliance claim. It describes what the code does
and what was measured.

What is next is in **[docs/ROADMAP.md](docs/ROADMAP.md)**.
