# Roadmap

Where Robis is, what is left, and what is deliberately not being built.

Status (2026-10-31): **968 TypeScript tests, 100 Python tests, lint and
typecheck clean, production build passing.** This is the one place test counts are kept; a
test (`tests/doc-links.test.ts`) refuses a count anywhere else, so the other
documents point here instead of drifting.

A full inventory of what exists is in
[COMPLETE_APP_SUMMARY.md](../COMPLETE_APP_SUMMARY.md). The reasoning behind
each choice is in [ARCHITECTURE.md](ARCHITECTURE.md).

**One home per topic.** Status, the known gaps and what is deliberately not
being built are written here and nowhere else; the reasoning lives in
ARCHITECTURE.md and the inventory in COMPLETE_APP_SUMMARY.md, and the other
documents link to them. `tests/doc-homes.test.ts` refuses those sections
anywhere else. **When a feature lands**, search the docs for anything still
calling it missing (`git grep -n -iE "not yet|no .* yet|missing|gap"` over
`*.md`) and correct it in the same commit.

---

## Shipped

**Foundation.** Bun monorepo, Fastify API, Drizzle and Postgres, Next.js web
app, CI running lint, typecheck, tests, the Python suite from its lock and a
production build, installing exactly what the lockfiles record.

**Tenancy and authorisation.** Workspaces, four roles, one declarative
permission matrix, 404-not-403 for non-members.

**Audit trail.** Every workspace change recorded in the transaction that
makes it, numbered per workspace and chained, each event signed with an
HMAC key held outside the database; an app database role that can only
append to it; an append-only trigger; a verify endpoint that names the
first broken link and starts from a signed checkpoint; reads, exports and
checks recorded as events; a keyset-paged
export; an at-least-once HTTPS stream to a SIEM with an idempotency key per
event; a Security view for admins. Gaps and limits are listed in
`docs/PLATFORM_PLAN.md`, Phase 2.

**Accounts.** Argon2id passwords, opaque sessions, login timing equalisation,
password reset and email verification sent by the worker over SMTP, account
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

**Machine learning.** `robis-ml/`: duplicate detection and priority triage,
behind a service token, wired into the issue composer. Typing a title shows
possible duplicates with a match percentage; a missing or broken ML service
degrades to no hints and never blocks filing. The priority model is wired in
the same way: the composer offers a suggested priority with its score, filed
only if somebody presses Use, and below the 40-issue training minimum it says
so with the counts instead of guessing. Triage evaluation is repeated
stratified k-fold against a stratified-random baseline with a margin gate, a
time-ordered holdout, and a Brier score. Duplicate detection is measured
against a labelled set of 84 queries: pair-level precision and recall, with a
threshold chosen on a dev half and reported on a test half with Wilson
intervals. On the test half: precision 0.79, recall 0.62, and 0 of 7 on
lexical-gap duplicates. The set is small and written by the project author,
so these are not production figures. The dev-chosen 0.40 was not confirmed
as better than the old 0.35 on test; the difference is inside the noise. A
test keeps the default threshold equal to the dev choice. Cached models are invalidated by a `(count, max(updated_at))`
fingerprint rather than a timer.

---

## Pick up here next session

### 1. A labelled set somebody else wrote

Now the most useful next step, because the current set has reached what it
can say:

- **Its author built the model.** A second author, or real duplicate pairs
  from a live workspace, would test whether these numbers survive somebody
  else's wording.
- **Its test half has been read**, so it can no longer confirm a change.
- **All 4 word-form gap queries landed in dev**, so test cannot measure
  word-form gaps at all.

Write the new set with the split stratified by gap kind as well as category.
Then re-test the one unconfirmed candidate: `char_wb 3-5`, which had 2 of 11
hard-negative false alarms against 4 of 11 on both halves of the current set.

### 2. Stemming, then embeddings, for the lexical gap

Character n-grams were tried, through `python -m robis_ml.duplicate_eval
--compare`. None met the rule fixed in advance: lexical-gap recall up, with
hard-negative false alarms not up. Production stays on word TF-IDF. The
write-up is in [robis-ml/README.md](../robis-ml/README.md).

What is left:

- **Stemming** may help the word-form kind ("paging" against "pagination").
  It needs a new dependency, so record its licence before adding it.
- **Embeddings** are the experiment for the synonym kind ("throttle" against
  "rate limit"), which shares no characters. They stay blocked until weights
  can be downloaded.

### 3. Mail beyond the first driver

SMTP is in, and account mail goes through the job queue. What is left: try a
real provider, tell someone when a mail job dead-letters, and handle bounces
before sending anything people did not ask for.

### 4. Decide what a verified address gates

Settled (B4, 2026-10-16): joining a workspace. Adding someone is now an
invitation they accept or decline, and accepting needs a confirmed address;
the workspaces page says so and offers the link again. Everything else a
new account does still works before the address is confirmed.

### 5. Deferred review findings

- Migrate the login page onto `AuthShell` so all five auth surfaces share one.
- (Done: `trustProxy` pinned, and no-referrer / no-store on token pages.)

---

## Remaining backlog

**Sync.** The offline engine's transport (`frontend/lib/sync.ts`) still
types issue answers as its own `LocalIssue`. Creating or editing an issue
answers without the assignee's name, so a locally edited row shows no
assignee name until the next full sync; either the issue answers gain
`assigneeName` or the engine keeps the stored one when the assignee is
unchanged.

**Operations.** Distributed tracing across API, gateway and worker.
Request ids now span the API and the ML service; the gateway and worker are
next. Rate limits key on the full IPv6 address, so a client holding a /64
can rotate within it; key on the /64 instead.

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
| Deployment | A host and accounts, chosen by the owner (A4) |

The container build is no longer blocked. It is verified in CI, by the
`containers` job on every push: every image built, the stack started with
every health check passing, a smoke test through sign-up, email, a
workspace, a live issue and an upload, and an image scan. It has also been
run on the development machine.

---

## Known gaps

| Gap | Why |
| --- | --- |
| Attachments beyond images | Only images are accepted; PDFs and other files are not, because their metadata cannot be stripped the same way |
| Mail deliverability | Sent over SMTP and tested against a local SMTP server only. No provider has been tried, and there is no HTML version, bounce handling or unsubscribe |
| Object storage | The S3 driver is tested in CI against S3Mock, not against a cloud provider |
| Deployment | Not done. The production compose file and edge proxy are smoke-tested in CI with a throwaway certificate, but nothing runs anywhere public |
| Duplicate detection, reworded intent | Finds 0 of 7 lexical-gap duplicates on the labelled set's test half |

The deployment gap waits on choosing a host and accounts. Attachments and
duplicate recall are real work that has not been done.

## Waiting on legal review

The audit trail is built to outlive the accounts it names. New member events
record a username rather than an email or real name, kept beside the hashed
trail so `bun run audit:erase -- <user id>` can remove it while the chain
still verifies. That erasure is a technical design marked for legal review,
not a claim about any law. Events written before it hold their username,
or before usernames their email, inside the hashed payload, where erasing
it would break the chain. How long to keep the trail, and how that sits
with a request to erase someone's data, needs a legal review before any
real users. The terms and privacy pages are drafts for the same review, and
the minimum age (16) is a placeholder. What each account agreed to is
stored (the age confirmation, the terms version and when), and so is its
answer when the terms change; how long those records are kept is part of
the same review.

---

## Deliberately not doing

**Any compliance claim.** The code does what these documents describe. That
is not the same as being certified, secure or compliant, and they do not say
it is.

**Direct messages.** They need a different privacy story: who may read the
transcript, what an export contains, what happens when somebody leaves.
Bolting them onto a workspace-scoped table would answer those questions badly
and silently.

**A public project directory with match percentages.** Robis workspaces are
private tenancies with invite-only membership, and the 404-not-403 rule is
tested. A public discovery surface would contradict that access model rather
than extend it. If it is ever wanted, it belongs as a separate public surface
with its own threat model, not as a flag on `workspaces`.

**Conferencing.** Robis stores a link. Minting rooms would put a third party
in the request path and imply a provider relationship that does not exist.

**Microservices beyond the four that exist.** The API, gateway and worker are
split because they have genuinely different runtime shapes. Splitting further
would add network calls between things that share a transaction today.

**Kubernetes manifests nobody has run.** Writing deployment configuration that
has never been applied produces documentation that is wrong in ways no one can
see. It stays out until there is somewhere to deploy to.
