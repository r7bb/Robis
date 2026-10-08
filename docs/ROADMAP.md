# Roadmap

Where Relay is, what is left, and what is deliberately not being built.

Status: **393 TypeScript tests, 17 Python tests, lint and typecheck clean,
production build passing.**

A full inventory of what exists is in
[COMPLETE_APP_SUMMARY.md](../COMPLETE_APP_SUMMARY.md). The reasoning behind
each choice is in [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Shipped

**Foundation.** Bun monorepo, Fastify API, Drizzle and Postgres, Next.js web
app, CI running lint, typecheck, tests and a production build.

**Tenancy and authorisation.** Workspaces, four roles, one declarative
permission matrix, 404-not-403 for non-members, an append-only audit trail.

**Accounts.** Argon2id passwords, opaque sessions, login timing equalisation,
password reset and email verification behind a `Mailer` port, account
settings.

**Realtime.** Postgres `LISTEN/NOTIFY` as the backplane, a separate Bun
WebSocket gateway, presence with TTL sweep, live board and comment updates.

**Offline.** IndexedDB mutation queue, exactly-once via client ids plus a
server-side idempotency ledger, an optimistic board that works with the
network off, a service worker, a sync status indicator.

**Documents.** Yjs CRDTs over the gateway, `bytea` storage, an append-only
update log with compaction, live cursors.

**Chat.** Workspace channels, message history with keyset paging, moderation,
day separators and author grouping, realtime delivery carrying ids only.

**Meetings.** Scheduling, invitations intersected with the roster, RSVP,
reschedule-clears-answers, cancel-not-delete.

**Search, notifications, background work.** Postgres full-text search over
issues, documents and comments; a notification inbox with dedupe; mention
notifications and stale-issue nudges on a `SKIP LOCKED` job queue.

**Operations.** Prometheus metrics on the API and gateway, a load harness with
published numbers, a screenshot script that drives a real browser.

**Presentation.** A landing page, a short README, 28 captured screenshots.

**Machine learning.** `relay-ml/`: duplicate detection and priority triage,
behind a service token, wired into the issue composer. Typing a title shows
possible duplicates with a match percentage; a missing or broken ML service
degrades to no hints and never blocks filing. Evaluation is repeated
stratified k-fold against a stratified-random baseline with a margin gate, a
time-ordered holdout, and a Brier score. Cached models are invalidated by a
`(count, max(updated_at))` fingerprint rather than a timer.

---

## Pick up here next session

### 1. A labelled duplicate set

Everything else about the duplicate feature is built and verified end to
end; what is missing is evidence that it is any good. See item 2.

### 2. Precision and recall for `DuplicateFinder`

The triage model is now measured properly (repeated stratified k-fold against
a stratified-random baseline, a time-ordered holdout, and a Brier score, with
a margin the model must clear). The duplicate model is not measured at all,
because no labelled set of true duplicate pairs exists.

Build one from the seeded corpus plus real paraphrases, then report precision
and recall at several thresholds. Until that exists, 0.35 is a guess tuned by
eye and the model is not validated.

### 3. An SMTP driver for the `Mailer` port

The only driver is `ConsoleMailer`, which prints reset links to stdout. The
API refuses to start in production without a real one. Once SMTP exists, move
sends onto the job queue and drop the startup refusal.

### 4. Decide what a verified address gates

`users.email_verified_at` is recorded and nothing depends on it. Either gate
something (invitations, perhaps) or say in the UI that it is informational.

### 5. Deferred review findings

- Pin `trustProxy` rather than leaving it at the default.
- `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on pages that
  carry a token in the query string.
- Migrate the login page onto `AuthShell` so all five auth surfaces share one.

---

## Remaining backlog

**Operations.** Distributed tracing across API, gateway and worker.
Structured request logging with correlation ids.

**Product.** Drag-and-drop on the board. A dedicated search results page.
Issue filtering by label. Bulk actions.

**ML.** A sentence-embedding baseline to compare against TF-IDF, once weights
can be downloaded. The gap is already visible: "auth" scores 0.64 where
"authentication" scores 0.26 for the same intent.

---

## Blocked by this machine

Not skipped, blocked. Each is stated rather than disguised.

| Blocked | Needs |
| --- | --- |
| File uploads | Object storage |
| Verified container build | Docker |
| Production mail | SMTP |
| Deployment | The above |

---

## Deliberately not doing

**Direct messages.** They need a different privacy story: who may read the
transcript, what an export contains, what happens when somebody leaves.
Bolting them onto a workspace-scoped table would answer those questions badly
and silently.

**A public project directory with match percentages.** Relay workspaces are
private tenancies with invite-only membership, and the 404-not-403 rule is
tested. A public discovery surface would contradict that access model rather
than extend it. If it is ever wanted, it belongs as a separate public surface
with its own threat model, not as a flag on `workspaces`.

**Conferencing.** Relay stores a link. Minting rooms would put a third party
in the request path and imply a provider relationship that does not exist.

**Microservices beyond the four that exist.** The API, gateway and worker are
split because they have genuinely different runtime shapes. Splitting further
would add network calls between things that share a transaction today.

**Kubernetes manifests nobody has run.** Writing deployment configuration that
has never been applied produces documentation that is wrong in ways no one can
see. It stays out until there is somewhere to deploy to.
