# Platform plan: agents, audit, insight

The next stage of Robis, scoped from a scan of where comparable products are
heading (Linear, Jira, Plane, Notion, Slack, ClickUp) and of what Robis can
build and verify on this machine. Every phase ends in a working, tested,
committed state, so the plan can stop after any of them and still be honest.

The through-line: **agents work in Robis like people do, everything anyone
does lands in a tamper-evident audit trail, and the product measures itself
in the open.**

Constraints that shape it: no LLM API key, so the demo agent is scripted;
no Docker, SMTP or OAuth accounts, so integrations are file- and
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
  in the trail. The SIEM copy is where it survives.
- Sign-in, password and session events are account-level, not
  workspace-level, so they are not in this trail yet.
- Rows written before the chain existed were numbered by timestamp; rows
  that shared one were ordered by id, since nothing recorded their real
  order.
- Appends take a per-workspace lock until commit, so writes in one workspace
  queue behind each other for the length of the audit insert. A writer waits
  at most 5 seconds for it.

Left open from review, for a later pass:

- The app connects as the table's owner, so the append-only trigger is the
  only database-side guard. A separate runtime role without `UPDATE`,
  `DELETE` or `TRUNCATE` on `audit_events` is the stronger setup.
- The hash is unkeyed. An HMAC with a key held outside the database would
  stop someone with database access from rewriting the chain consistently.
- Reading or exporting the trail is not itself recorded.
- Member events copy the member's email and name, and the trail outlives
  accounts. Erasure requests need a redaction strategy: flagged for legal
  review.
- The security view's "who" filter lists current members only.
- Verification walks the whole chain each time, which is why it is
  rate-limited; a stored checkpoint would make it incremental.

## Phase 2b. Profiles, photos and stories (M to L)

Inside the workspace only: Robis's tenancy and 404-not-403 rules stay as
they are, so nothing here is public.

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

---

Each phase updates `docs/ROADMAP.md` and the README when it lands, and
records the licence of any dependency it adds in `THIRD_PARTY_NOTICES.md`.
