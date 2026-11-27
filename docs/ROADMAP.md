# Roadmap

Where Robis is, what is left, and what is deliberately not being built.

Status (2026-11-27): **2220 TypeScript tests, 132 Python tests, lint and
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

**Insights.** Cycle time and throughput per project from the status
changes in the audit trail: the median, its spread and the issues behind
it, and below ten finished issues the counts instead of a figure. Tested
against a seeded history with hand-worked answers. System health beside
it: hint acceptance for admins, and for the server's operators the job
queue, sync lag and live-update latency, from timings the services record
as they work.

**Meetings.** Scheduling, invitations intersected with the roster, RSVP,
reschedule-clears-answers, cancel-not-delete.

**Search, notifications, background work.** Postgres full-text search over
issues, documents, comments, chat, space threads and replies, and meetings; a
notification inbox with dedupe; mention, space reply and answer notifications
and stale-issue nudges on a `SKIP LOCKED` job queue.

**First run and empty views (C5).** A new account goes from sign-up to a
board with work on it in nine clicks: a workspace, its look and a teammate,
then a first project from a template (software, event planning,
coursework). Every empty view says what goes there, in its guide's words,
with the one button that fills it, and a demo workspace with a board, a
document, a channel and a meeting can be opened from the first run.

**Data in and out (C6).** An admin exports a whole workspace as JSON
lines with its images in one zip, built by a job and downloaded once
through a five-minute single-use link, each step audited. A board imports
issues from a CSV file, a Robis export or a GitHub repository, statuses
and labels mapped, and a rerun adds nothing; an export imported into a
fresh workspace reproduces issues, comments and labels. Account deletion
(transfer or delete each owned workspace) came with B3.

**Accessibility and languages (C9).** axe-core checks every
page the screenshot script captures, on three themes, in CI, and fails on
serious or critical findings; the contrast, naming and keyboard problems
it found are fixed. The landing field stills when reduced motion is turned
on, even with the page open. Every dialog works by keyboard and is named
for screen readers, checked by a journey. Strings live in typed message
files, English and Spanish (written during the build, not yet read by a
native speaker), chosen on the account page or from the browser; every
date, time and number follows the viewer's locale through one module. The
shell, calendar and Spaces are translated; other screens move a key at a
time ([Languages](LANGUAGES.md)).

**Phone and installable app (C8).** A manifest and icons so
a phone installs Robis to its home screen, and every page checked at
390 by 844 by a browser journey. An issue seen once opens with no network
and a comment written then is sent once on reconnect, checked at phone
size with the network off. A photo, link or words shared from another
app become an issue on the board picked, through the same offline queue.

**Integrations (C7).** Outgoing webhooks per workspace:
chosen events, HTTPS only, signed with HMAC over a timestamp and the body,
a delivery id that stays the same across retries, five tries over two and
a half hours and a delivery log for admins; payloads hold ids and only what the
webhook's maker may still read. Personal access tokens for the API:
read only unless allowed to write, shown once, stored as a hash, honoured
on workspace routes only, revoked at once, with their last use. GitHub
pull requests show on the issues their title or branch names, and a
merge can move the issue to done. An API reference, docs/API.md, is
written with the OpenAPI document from the same contracts, and a running
server serves that document at /api/openapi.json.

**Load, soak and failure drills (E2).** The worker, gateway, Postgres and
ML service each broken on purpose in CI, recovering with no lost write
and nothing done twice; the load harness in CI against a baseline of the
last three main runs; a thousand sockets held for half an hour with no
growth and no ghosts.

**Automation rules (B9).** Rules with a trigger, conditions and an action
(field changes, comments, notices, channel posts, signed webhooks to public
https addresses), run once per change as a recorded actor, never on their
own change, chains stopped three deep, managed on the Automations page.

**Calendar (B8).** A private feed per person, revocable; weekly
repeating meetings kept at the organiser's local time across clock
changes; .ics import, with invitees matched to the roster for admins; and
a week view of meetings and due issues in the viewer's own zone.

**Security checks (E3).** Trivy scans the repository and the images, an
OWASP ZAP baseline scan of the stack runs in CI against triaged rules, and
a threat model covers uploads, stories, agents, outbound calls and tokens
([SECURITY_CHECKS.md](SECURITY_CHECKS.md), [THREAT_MODEL.md](THREAT_MODEL.md),
[SECURITY.md](../SECURITY.md)). What is checked, not a claim of security.
No active scan yet, and nobody outside the project has tested it.

**A lively demo.** `bun run demo:life`, or the stack with `--profile
demo`, keeps the seeded teammates present and has them and two agents
chat, post, react, comment and move work along from written lines,
through the API. Development only.

**Browser journeys (E1).** Seven whole journeys in real Chrome against
the container stack, in CI on every push and pull request, each with
fresh accounts in Chromes of their own. A queue made to send nothing
fails the offline journey.

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

**Partly done (D1, 2026-11-24).** A second set of 120 queries, tagged by gap
kind, with its split stratified by kind and topic and committed before the
report; a test freezes the test half to the report alone. Results are in
the ML README: `char_wb 3-5` again had fewer hard-negative false alarms (1 of
15 against 5 of 15) and neither model found a lexical gap (0 of 10). It was
written by the AI assistant that built the model, at the owner's request,
so it is not independent. What remains is a second author following
`robis-ml/robis_ml/datasets/independent/GUIDE.md` without seeing the model.

### 2. Stemming, then embeddings, for the lexical gap

**Measured (D2, 2026-11-24).** On the second set's dev half, stemming and a
words-plus-embeddings blend failed the rule; MiniLM sentence embeddings met
it (lexical gap 3 of 10 against 1, hard-negative alarms 9 of 15 against
14), and on the test half had recall 0.66 against 0.34 and 1 of 15 alarms
against 5. **Served** from the ML image since 2026-11-24 (fetched and
hash-checked at build; 3.8 ms a query at the median), with word TF-IDF as
the fallback where the model is absent.

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

**Operations.** A5 is done: traces join every service, logs are JSON
lines naming their trace, and alert rules have promtool tests and a
runbook. Not yet tried against a real collector or Prometheus, since none
runs here. The images still run
`apt-get upgrade` over their pinned bases: on 2026-10-31 the newest
`oven/bun:1.4.2-slim` digest had three critical findings with a fix, which
the upgrade removes and the image scan would otherwise fail on. Drop the
step once a digest Dependabot proposes scans clean (stage 4, item 38).

**Product.** Sapha reads a dozen kinds of request in the palette, and with
assistance on, asks the provider about the rest (tier 1); next, answers to
questions (what is blocking REL-4?) drawn from the workspace, with sources. (Drag and drop on the board, the search results page,
filtering by label and bulk actions, once listed here, are built: see
`frontend/features/board/` and the search page.)

**ML.** Sentence embeddings are served for duplicates, with TF-IDF as the
fallback (`robis-ml/README.md`); the next step is a labelled set large enough
to tune the threshold per workspace rather than once.

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
