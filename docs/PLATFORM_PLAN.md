# Platform plan: agents, audit, insight

The next stage of Robis, scoped from a scan of where comparable products are
heading (Linear, Jira, Plane, Notion, Slack, ClickUp) and of what Robis can
build and verify on this machine. Every phase ends in a working, tested,
committed state, so the plan can stop after any of them and still be honest.

The through-line: **agents work in Robis like people do, everything anyone
does lands in a tamper-evident audit trail, and the product measures itself
in the open.**

Constraints that shape it: no LLM API key, so the demo agent is scripted;
no OAuth accounts and no mail provider, so integrations are file- and
endpoint-based and verified against local stand-ins; nothing here claims
compliance with any standard.

---

## Phase 1. Backend hardening (S)

The deferred review findings, done before anything is built on top.

- Pin `trustProxy` to configuration instead of `true`, so a client cannot
  spoof its IP past the rate limiter. Default: no proxy trusted.
- `Referrer-Policy: no-referrer` and `Cache-Control: no-store` on the pages
  that carry a token in the URL (reset, verify).
- Correlation ids: accept a well-formed incoming `x-request-id` or mint one,
  echo it on the response, put it on every log line, and forward it to the
  ML service.

Done when: tests prove a spoofed `x-forwarded-for` is ignored by default,
the headers are present, and a request id round-trips.

## Phase 2. Audit trail and SIEM export (M)

- Every route that changes data writes `audit_events` in its transaction,
  with the actor and the actor's kind. A rolled-back change leaves no row.
- Hash chaining per workspace: each event stores the hash of the previous
  one, so deleting or editing a row is detectable. A verify endpoint walks
  the chain.
- Export: a cursor-paged API, and a stream to a configured HTTPS endpoint
  through the job queue, with an idempotency key per event so a receiver
  can drop the duplicates a retried job produces.
- A security view in the workspace: who did what, filterable, with the
  chain's verification status.

Done when: a test tampers with a row and verification names it; a local
fake receiver gets every event exactly once by key despite a forced retry.

**Shipped 2026-10-09.** `backend/database/src/audit.ts`, migration 0010,
`/audit/events` and `/audit/verify` (admins and owners), the worker's
`audit.stream` job, and the Security view. Tests: `tests/audit.test.ts`
(every route, rollback, 20 concurrent writers, three kinds of tampering, the
SQL and application hashes agreeing) and `tests/audit-stream.test.ts`.

Deliberate gaps, stated rather than hidden:

- Posting a chat message and typing in a document record no event. The
  message and the CRDT log are their own record; deletes and renames are
  recorded.
- Deleting a workspace deletes its trail with it, so that one change is not
  in the trail. The SIEM copy is where it survives. Since 2026-10-15 the
  deletion leaves a tombstone (the trail's length and last hash), written by
  an owner-run trigger into a table the app can only read.
- Sign-in, password and session events are account-level, not
  workspace-level, so they are not in this trail yet.
- Rows written before the chain existed were numbered by timestamp; rows
  that shared one were ordered by id, since nothing recorded their real
  order.
- Appends take a per-workspace lock until commit, so writes in one workspace
  queue behind each other for the length of the audit insert. A writer waits
  at most 5 seconds for it.

Left open from review, for a later pass:

- ~~The app connects as the table's owner.~~ **Closed 2026-10-15 (B3):**
  the app connects as `robis_app`, which can read and insert audit events
  and nothing more; migrations and `db:roles` run as the owner.
- ~~The hash is unkeyed.~~ **Closed 2026-10-15 (B3):** new events are an
  HMAC with a key from `AUDIT_HMAC_KEYS`, outside the database, with the key
  id stored per event. Unsigned rows from before verify only ahead of the
  first signed row; `bun run audit:seal`, run once when upgrading, gives
  every intact old chain a signed event. Still open from its review: a row
  naming a retired key reads as "cannot check", which is also what a forger
  could produce with a real-looking id, so keys must not be retired while
  events need them; the role's password is sent as text in `ALTER ROLE`
  rather than as a SCRAM verifier; new tables get full grants unless listed
  as append-only or read-only; a process with no NODE_ENV counts as
  development, as it does everywhere else in the API.
- ~~Reading or exporting the trail is not itself recorded.~~ **Closed
  2026-10-15 (B3):** each read, export page and check is an `audit.*`
  event, kept out of the members' activity feed.
- ~~Member events copy the member's email and name.~~ **Addressed
  2026-10-15 (B3), as a design flagged for legal review:** new member events
  keep the username beside the hashed payload with a salt and a
  commitment, and `bun run audit:erase` removes it while the chain still
  verifies. Older events keep what they recorded inside the hash.
- **Account trail, added 2026-10-15 (B3):** sign-ins, failed sign-ins,
  sign-outs, password changes and resets and session revocations, chained
  and signed per account, shown to the holder in Account settings.
  Failed sign-ins within five minutes are one entry; a failure is written
  after its reply, so its timing does not say whether the account exists.
  Open, from its review: the deferred write still competes for database
  connections, a residual timing signal that has not been measured; the
  account chain has no checkpoint, so dropping its newest events is not
  detected; erasure by the runtime role leaves no record of itself and
  cannot be told from an event that never had personal fields; there is no
  account deletion yet, and when there is, the account's history goes with
  it; signing out one session by itself has no route, and a person cannot
  export their own history.
- ~~The security view's "who" filter lists current members only.~~
  **Closed 2026-10-15 (B3):** `/audit/actors` lists everyone in the trail
  by username, former members marked.
- ~~Verification walks the whole chain each time.~~ **Closed 2026-10-15
  (B3):** checks start from a signed checkpoint that may only move
  forward; `?full=1` walks everything under a smaller rate limit. A quick
  check does not see an edit behind the checkpoint, which is what the full
  check is for. Still open from its review: a workspace with no usable
  checkpoint walks everything on a quick check, billed to the quick
  check's larger budget; reads are recorded once a minute per person, so
  two reads a few seconds apart are one event.

## Phase 2b. Profiles, photos and stories (M to L)

Inside the workspace only: Robis's tenancy and 404-not-403 rules stay as
they are, so nothing here is public. The intent, in the owner's words: a mix
of social media and work.

Order of work, decided 2026-10-09:

1. **App-specific usernames.** Every account gets a unique `@handle`
   (lowercase letters, digits, `_` and `.`, 3 to 30 characters), chosen at
   sign-up and backfilled for existing accounts from the email's local part.
   From then on the audit trail records the handle, never an email or real
   name, which removes the erasure problem Phase 2 left open for new events.
   Mentions move to `@handle`. Sign-up keeps its age confirmation and
   terms/privacy links, flagged for review. **Shipped 2026-10-09.** Emails
   are now shown only to admins in the member list.
   Left open from review, and since closed (B4, 2026-10-16): a released
   username is now held for 90 days in `username_history`, and only its
   last owner may take it back; mentions are resolved to people when a
   comment is written (`comment_mentions`), so an old `@name` still points
   at whoever it meant; lookalikes collide on a key that ignores dots and
   underscores and reads 0 as o and 1 as l. Old usernames are personal data
   kept for the 90 days of their hold; `audit:erase` forgets them and keeps
   the hold (for legal review, like the rest of erasure). Adding someone is now an
   invitation they accept or decline, and accepting needs a confirmed email
   (B4, 2026-10-16). Still open from that list: the age
   confirmation is not stored with a timestamp or terms version; and
   accounts that predate usernames are not prompted to choose a new one.
2. **A picture before you start.** A new member adds at least one image
   before using the workspace: upload a photo, take one with the camera, or
   pick a generated avatar. The avatar is per account and is served only to
   people who share a workspace with its owner. **Shipped 2026-10-13**, with
   the gate enforced by the API and the realtime gateway as well as the app.
   Left open: picture changes are not yet in an account trail (B3 in the
   build plan); storage is local disk only, with no object-store driver yet.
3. **Photos and stories**, as below.

- Rich profiles: photo, cover, role, a "working on" line, recent activity,
  and a grid of what the person has shared.
- Stories: photo or text updates that expire after 24 hours, shown as rings
  on team avatars, delivered live through the gateway.
- Capture: camera and pasted screenshots into an issue, a chat message or a
  story, on phone and desktop.
- Offline: a photo taken with no signal queues and uploads exactly once on
  reconnect, through the existing sync queue.
- Storage on local disk in development behind a storage port, so a real
  backend can replace it later; images resized with `sharp` (Apache-2.0,
  recorded in THIRD_PARTY_NOTICES.md).
- Privacy: location metadata stripped on upload, deletes that remove the
  file, stories that really expire, and membership checked on every image
  request so a leaked link alone shows nothing. Every upload and delete
  lands in the Phase 2 audit trail. Flagged for legal review before any
  real users, as it handles personal images.

## Phase 3. Agents as teammates, over MCP (M)

- Users gain a `kind` (human or agent). Agents are workspace members with
  revocable tokens and a role like anyone else; the human stays the
  assignee and the agent is recorded as delegate.
- `backend/mcp`: an MCP server exposing search, read, create, update and
  comment on issues, every call through the existing permission matrix
  and every write through the idempotency ledger.
- A scripted triage agent (no LLM): reads new issues, asks `robis-ml` for
  duplicates and priority, comments its reasoning, and never acts without
  the same advisory rules the composer follows.

Done when: integration tests cover a denied call, a replayed write that
does not duplicate, and a revoked token that stops working at once.

## Phase 4. Watching agents (M)

- `agent_runs` and `agent_steps`: each run as a timeline of tool calls with
  latency and outcome. Prometheus metrics for tool latency, errors and
  denials.
- The honest quality measure: of the changes an agent made, how many did a
  human keep, edit or revert. Shown per agent, with the counts.
- An activity view: runs, steps, and kept or reverted marks.

## Phase 5. Suggestion feedback loop (S)

- Log every accept or dismiss of a duplicate or priority hint.
- Report the live acceptance rate beside the offline evaluation, clearly
  labelled as a different measurement.

## Phase 6. Insights dashboards (S to M)

- Cycle time and throughput per project, from real status-change events.
- System health from real instruments: sync lag, queue depth, realtime
  fan-out latency, suggestion acceptance.

## Phase 7. Calendar (S to M)

- An ICS feed per member for meetings, with a revocable feed token.
- `.ics` import for meetings.
- Issues as time blocks on a week view. Time zones handled explicitly;
  recurrence limited to what is tested.

## Phase 8. Automation rules (M)

- Trigger, condition, action, run on the job queue, with loop detection (a
  rule cannot trigger itself) and idempotent execution.

## Images on issues and comments (A2 in the build plan)

**Shipped 2026-10-13.** A storage port with local-disk and S3 drivers (the S3
one tested in CI against S3Mock), image attachments on issues and comments,
offline upload through the sync queue, file removal queued with every
delete, and offline data bound to its account and cleared on sign-out.

Left open: no storage quota per workspace (only a per-account upload rate);
images only, since other files' metadata cannot be stripped the same way;
a file uploaded in the instant between a parent's key lookup and its delete
can be missed by the purge; no `Range` requests for large images.

## Real mail (A1 in the build plan)

**Shipped 2026-10-13.** An SMTP driver behind the `Mailer` port, through
`nodemailer`. Every account email is a job: the API queues the account id,
and the worker issues the link and sends it, retrying with backoff and then
keeping a dead letter. The forgot-password reply keeps its fixed response
time and per-recipient limit. `bun run mail:start` runs a local SMTP inbox,
and one test goes through the real driver to it. Production refuses to start,
API and worker alike, with no mail driver configured.

Left open: tried against a local server, never a real provider; plain text
only; no bounce or complaint handling; a dead-lettered email is visible in
the jobs table but nobody is told.

## Container images (A3 in the build plan)

**Shipped 2026-10-15.** One image per service in `deploy/docker`: a
backend Dockerfile with a stage each for the API, gateway, worker and mail
sink, plus the web app (Next standalone) and the ML service (hash-locked to
the versions its tests ran on). All of them are multi-stage, run as a
non-root user, start from base images pinned by digest with Debian's security
updates applied, and have a health check. The worker has no port, so it
touches a heartbeat file after each poll. `deploy/compose.yaml` runs the whole
stack with Postgres, S3Mock and the sink. The CI `containers` job builds it,
waits on every health check, migrates once, runs `scripts/smoke/stack.ts`,
boots the API and worker in production mode to see them refuse without
mail, and scans every image with Trivy.

Deviations, stated: S3Mock stands in for MinIO, whose image is no longer
published on Docker Hub. The stack runs in development mode because it is
plain http.

The CI job's token is read-only, its actions are pinned to commits, and
the scanner reads image tarballs rather than the Docker socket. It also
fails on a secret found in any layer, and on a source map or env file in
the web image. Compose drops every Linux capability from Robis's services.

Left open:
- Images are not published to a registry, and there is no SBOM yet (F3).
- The smoke test does not cover the ML service's suggestions, or the web
  app beyond its first page.
- The scan gates on critical findings only.
- The mail sink's own dependencies are pinned at the top level but not
  locked.
- The stack's credentials are fixed throwaway values.
- The ML service accepts a short token, and its anonymous switch has no
  production guard.
- Applying Debian updates at build time means two builds on different days
  can differ.
- The worker's health check needs a writable `/tmp`.

## Track F. Store readiness and 2027 rules (from the owner, 2026-10-13)

Most of these apply once Robis ships as a Play Store or App Store app,
including a wrapped PWA. The dates come from the owner's notes and must be
checked again before shipping; items touching age, the Cyber Resilience Act
and the AI Act belong in the legal review the README already flags. Nothing
here is a claim of compliance with anything.

- **F1. Age signals.** Replace the sign-up checkbox with an age-signal port:
  Apple Declared Age Range and Google Play Age Signals in the native shells,
  self-declaration on the web. Store an age bracket, its source, the terms
  version and the time, never a birthdate. Minimum age 18, minors refused,
  re-checked at most yearly. Open question first: an 18-plus minimum rules
  out the coursework and student audience C5 has in mind.
- **F2. Store-ready native shells.** Android (TWA or Capacitor) with Credential
  Manager and the Restore Credentials API, backed by a new revocable,
  hashed, audited credential type; iOS on Capacitor with the iOS 27 SDK and
  the social-features declaration. Low memory (no WebGL on app screens,
  lazy routes, sized images), in-app account deletion, content-free push.
  Needs a deployed backend (A4) first, and the emulator and store
  validation builds run in CI only: this machine has no mobile toolchain.
- **F3. Cyber Resilience Act readiness.** (The demo password refused outside
  development: shipped 2026-10-13. The rest is open.) A CycloneDX SBOM per release, a
  stated security support period in SECURITY.md, vulnerability intake and
  fix notices, secure defaults (two factor offered at sign-up, strict CSP,
  the demo password refused outside development), and a mapping doc of what
  each item covers and what still needs legal review.
- **F4. AI transparency.** Every agent and generated text labelled visibly and
  flagged in the API and exports, a workspace page listing each AI feature,
  what it sends and where, and an owner switch for each. Built into B5
  rather than added after it.

Placement: F1 before real sign-ups, beside the username follow-ups; F3's
SBOM with the container builds and its defaults with the security track;
F4 inside the agents phase; F2 after the first deployment.

---

Each phase updates `docs/ROADMAP.md` and the README when it lands, and
records the licence of any dependency it adds in `THIRD_PARTY_NOTICES.md`.
