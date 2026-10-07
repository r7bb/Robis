# Roadmap

Where Relay is, what is left, and what is deliberately not being built.

Status as of the current commit: **367 tests, lint and typecheck clean, CI green.**

---

## Shipped

### 1 · Foundation

- Bun monorepo — `apps/{api,realtime,web}`, `packages/{shared,database,auth,sync}`
- Fastify REST API, Drizzle ORM, PostgreSQL 18
- Next.js 15 client, React 19, Tailwind
- Local Postgres from npm-shipped binaries — no Docker, no admin rights
- Session auth: Argon2id passwords, opaque revocable server-side sessions
- Login timing equalised so registered emails are not enumerable

### 2 · Tenancy and authorization

- Workspaces, projects, issues, comments, append-only audit trail
- Four-role RBAC through a declarative permission matrix
- Non-members get 404 rather than 403, so workspace ids are not enumerable
- Structural rules: no granting above your own rank, no self-role changes, last
  owner protected from demotion/removal/leaving
- Per-project issue keys (`REL-104`) numbered under a row lock

### 3 · Realtime

- Separate Bun WebSocket gateway, authenticated with the same session cookie
- Fan-out over Postgres `LISTEN/NOTIFY` — transactional, so a rolled-back write
  emits no event
- Events carry ids, never row contents: one authorization path, self-healing
  across reconnects
- Presence in memory per instance, gossiped between instances, TTL-swept

### 4 · Offline

- `packages/sync`: IndexedDB store, durable mutation queue, ordered flush,
  reconciliation that preserves unflushed local work
- Exactly-once mutations: client-generated ids plus a server idempotency ledger
- Poison-message handling — permanent refusals are dropped, 408/429 are not

### Auth surfaces

- [x] Three new signed-out pages on a shared `AuthShell`, so sign-in,
      recovery and confirmation stop drifting apart
- [x] Accessibility pass over the whole client from the Web Interface
      Guidelines: `outline-none` with only a 1px border change was replaced
      with real focus rings in ten places, `min-h-screen` became
      `min-h-[100dvh]` on every entry surface, and mobile tap delay and the
      missing `theme-color` were fixed
- [ ] Gate something on a verified address. Deliberately open: verification
      currently records a fact and changes no behaviour, and choosing what it
      blocks is a product decision rather than a technical one

### Documentation

- [x] `scripts/screenshots.ts` — every image in the README captured from the
      running app by driving Chrome over CDP. The README claimed as much long
      before the script existed
- [x] A features list covering everything implemented, so the scope is legible
      without reading the whole file

### Account and audit

- [x] Editable issue descriptions — the field was in the schema, accepted by
      the API and indexed by search, with no UI to write it
- [x] Activity feed rendering the audit trail. The endpoint and the rows
      already existed and nothing consumed them
- [x] Audit payloads name what they describe: the member whose role changed,
      the issue whose status moved. Recorded at write time, so an entry stays
      truthful after the row is deleted
- [x] Account settings — display name, password change, active sessions with
      revocation. `revokeAllSessions` had been written and never called

### Deleting things

- [x] Trash control on every entity — workspace, project, issue, document,
      comment, membership, notification — behind a confirmation that names
      what cascades
- [x] Board deletes go through the offline mutation queue, so removing an
      issue works with no connection. Deleting an issue whose create has not
      synced still queues the delete rather than cancelling the pair: the
      create may already be in flight, and a 404 on the delete means the
      desired state already holds
- [x] Controls resolve against the same `can(role, permission)` matrix the API
      enforces, so a hidden button and a refused request agree

### Presentation and onboarding

- Six workspace themes on CSS variables, including a light palette, with WCAG
  contrast asserted per theme and a test that fails if anything bypasses the
  tokens
- Engagement nudges from a periodic scan, rate-limited by a weekly dedupe key
- Tips-style guide pages, one per nudge, ending in an action that does the thing

### 5 · Collaborative documents

The one place that genuinely needs CRDTs. Issue fields converge fine under
last-write-wins per field; concurrent edits to the *same paragraph* do not.

- `documents` table with an append-only update log and periodic compaction
- Yjs sync over the existing WebSocket gateway, with in-memory document rooms
- Awareness — live cursors, relayed and never persisted
- Editor bound to a shared `Y.Text`
- Convergence tests: concurrent edits, out-of-order delivery, duplicate
  updates, five replicas gossiping pairwise, and two live sockets

---

## In progress

### 7 · Hardening *(partly done)*

- [x] Service worker so the app shell loads with no network. Network-first for
      navigations, cache-first for fingerprinted assets, never for API traffic
- [x] Rate limiting on credential and search endpoints, injectable so the
      limiter itself is tested rather than disabled
- [ ] Docker verified end to end (compose file exists but has never run here —
      no container runtime on this machine)

---

### 6 · Background work *(mostly done)*

- [x] Job queue on Postgres `SKIP LOCKED` — backoff, dead-letter, visibility
      timeout, and enqueue that joins the caller's transaction
- [x] `@mention` parsing and in-app notifications, delivered by a worker
- [x] Session cleanup as a self-rescheduling job
- [x] Notification inbox UI with unread counts, mark-read and dismiss
- [x] Password reset and email verification, behind a `Mailer` port. Only the
      transport was ever blocked: hashed single-use tokens, expiry, no address
      enumeration and a timing floor are all buildable and tested without a
      provider. Production refuses to start on the console driver rather than
      print reset links to stdout
- [ ] An SMTP driver for that port, which is the one remaining piece. When it
      lands, the send should move onto the job queue: a network send inside the
      request is both slow and a timing signal
- [ ] File attachments via presigned URLs (needs an S3-compatible target)
- [x] Search — Postgres full-text over issues, comments and documents, on
      stored generated columns so the index cannot drift from the rows

---

## Remaining

### 8 · Operations

- [x] Prometheus metrics on the API and the gateway — request counts, latency
      histograms, in-flight gauge, fan-out deliveries, socket counts. Written
      by hand rather than `prom-client`; every label name is declared up front
      so a typo raises instead of opening a parallel series
- [ ] Distributed tracing. Metrics answer "how much and how slow"; a trace
      answers "where did this request spend its time", which is the question
      the NOTIFY-to-socket path would most benefit from
- [x] Load test of WebSocket fan-out and API throughput under concurrency, with
      the measured numbers in the README. Bun rather than k6, which ships as a
      Go binary this machine cannot install; the harness reports its own
      event-loop lag so a reader can tell the generator from the server
- [ ] Deployment

---

## Known gaps in what exists

Honest list of things that are built but thin.

- **Board uses a status dropdown, not drag-and-drop.**
- **Offline covers the board only.** The app shell is cached, but other routes
  still fetch their data and will show the offline fallback if visited cold.
- **The document editor is a plain textarea.** No formatting, and remote
  cursors are listed by name rather than drawn inline.
- **Search has no dedicated results page.** It is a dropdown capped at 20 hits
  with no pagination or filtering by kind.
- **Load-test numbers are laptop numbers.** One machine, loopback networking,
  local Postgres. Good for comparing commits against each other; not a capacity
  plan, and the README says so.

---

## Deliberately not doing

- **Elasticsearch, Terraform, NestJS.** Each adds operational surface without
  adding signal beyond what Postgres full-text search, docker-compose and
  Fastify already demonstrate.
- **Redis**, unless something needs it that Postgres genuinely cannot do. The
  NOTIFY-versus-Redis tradeoff is more interesting to explain than the presence
  of Redis is to list.
- **An AI feature as the centrepiece.** A small retrieval-and-summarise endpoint
  over issues and documents is worth adding at the end; it is not the project.

---

## Pick up here next session

In order. The first two are small and close out work started this session.

### 1. `26-reset-password.png` is skipped by the capture script

`bun run screenshots` completes but warns on this one. The reset form renders
correctly on a cold navigation (verified with a standalone CDP probe), yet
inside the script's session it reaches `/reset-password` without the query
string and shows the "link is incomplete" branch. The scene catches the failure
and carries on rather than blocking the other 26 images, and the README no
longer references the missing file.

Suspects, cheapest first: the service worker caching a navigation response for
that route, a `Page.navigate` racing the previous client-side navigation, or
the `Suspense` boundary resolving before search params are attached. One
instrumented run comparing `location.href` at navigate versus at first paint
should settle it.

### 2. An SMTP driver for the `Mailer` port

The only piece of the recovery work that is genuinely blocked on an external
service. Everything else is done and tested. When it lands:

- move the send onto the job queue, because a network send inside the request
  is both slow and a timing signal, which is currently handled by a floor
- drop the production startup refusal in `apps/api/src/main.ts`
- send a notification on password change, which the security review asked for
  and is the normal way a victim learns their account was taken

### 3. Decide what a verified address gates

Verification records a fact and changes no behaviour. That is deliberate --
choosing what it blocks is a product decision -- but leaving it inert
indefinitely makes the feature decorative. Candidates: being invited to a
workspace, inviting others, or nothing at all with the status simply shown.

### 4. Deferred review findings

From the two reviews of the recovery work. Neither blocks, both are real:

- `trustProxy: true` with no trusted-proxy list means `X-Forwarded-For` is
  spoofable if the API is ever reachable without a proxy in front, which makes
  every per-caller limit bypassable. Pin it to the proxy address or hop count.
- `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on
  `/reset-password` and `/verify-email`. The reset page strips the token from
  history after use; the headers close the rest.
- Login still has its own `Field` and submit button rather than using
  `AuthShell`, so the shared auth chrome unifies three pages instead of four.

### 5. Then the original backlog

Distributed tracing, drag-and-drop board, a dedicated search results page.
Still blocked by this machine: file uploads, Docker verified end to end,
deployment.
