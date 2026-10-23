# Robis: complete feature inventory

Everything the application does today, what it deliberately does not do, and
where each thing lives. [The README](README.md) is the short tour;
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the reasoning.

Written to be checkable. Every row names a file you can open.

---

## At a glance

| | |
| --- | --- |
| Services | 4 (web, API, realtime gateway, worker) plus an optional ML service |
| Database tables | 18 |
| HTTP endpoints | 60+ |
| Tests | Counted in [docs/ROADMAP.md](docs/ROADMAP.md), the one place they are kept |
| Screenshots | 28, all captured from the running app |
| Measured throughput | ~4,400 req/s, zero errors |

---

## Accounts and access

| Feature | Where |
| --- | --- |
| Register, sign in, sign out | `backend/api/src/routes/auth.ts` |
| Email-first sign-up: always "check your inbox", finished from a mailed link that confirms the address | `backend/api/src/routes/signup.ts`, `frontend/app/signup/` |
| Argon2id password hashing | `backend/auth/src/password.ts` |
| One configuration loader for every service and CLI, failing closed in production | `shared/contracts/src/config.ts` |
| Demo accounts seeded on the container stack's first start (owner rohit@robis.test) | `scripts/db/seed.ts`, `deploy/compose.yaml` |
| Security headers: nonce-based Content-Security-Policy, no framing, HSTS in production, camera for this origin only | `frontend/middleware.ts`, `frontend/lib/security-headers.ts`, `scripts/smoke/browser.ts` |
| Opaque server-side sessions (SHA-256 token hash) | `backend/auth/src/sessions.ts` |
| Login timing equalisation | `backend/api/src/routes/auth.ts` |
| Password reset by email, single-use token | `backend/api/src/routes/auth-recovery.ts` |
| Email verification | same |
| Change name, username or password | `backend/api/src/routes/auth.ts` |
| Rate limiting, per caller and per recipient address | `backend/api/src/plugins/rate-limit.ts` |
| App-specific `@usernames`, checked as you type, changeable | `shared/contracts/src/usernames.ts`, `backend/api/src/routes/auth.ts` |
| Lookalike usernames refused, released names held 90 days, mentions kept pointing at the person meant | `backend/database/src/usernames.ts`, `backend/api/src/routes/comments.ts` |
| Age confirmation at sign-up, enforced by the API (threshold is a placeholder for legal review) | `shared/contracts/src/schemas.ts` |
| What each account agreed to and when, asked again when the terms change; given usernames confirmed once | `shared/contracts/src/consent.ts`, `backend/api/src/routes/consent.ts`, `frontend/features/account/consent-flow.tsx` |
| Draft terms and privacy pages, marked for legal review | `frontend/app/terms/`, `frontend/app/privacy/` |
| A picture before anything else: upload, camera, or a generated pattern | `frontend/app/welcome/`, `backend/api/src/routes/avatars.ts` |
| Photos re-encoded to 512 px WebP with all metadata removed, location included | `backend/api/src/media/images.ts` |
| Photos served only to people who share a workspace (404 otherwise) | `backend/api/src/routes/avatars.ts` |

Sessions are opaque rather than JWTs so that changing a password kills every
existing session immediately. Reset tokens are stored only as a SHA-256 hash,
expire in 30 minutes, and are spent by `DELETE … RETURNING`, so there is no
second "consumed" state to get wrong.

## Workspaces, roles and tenancy

| Feature | Where |
| --- | --- |
| Live home after sign-in: field that ripples with live events, what needs you, live feed, workspace tiles with activity and presence | `frontend/app/workspaces/page.tsx`, `frontend/features/home/`, `backend/api/src/routes/overview.ts` |
| Create workspaces, invite members, set roles | `backend/api/src/routes/workspaces.ts`, `members.ts` |
| Invitations the invited person accepts or declines; joining needs a confirmed email | `backend/api/src/routes/invitations.ts`, `frontend/components/my-invitations.tsx` |
| Email invitations that answer the same whether or not the address has an account; cap per sender | `backend/api/src/routes/invitation-helpers.ts`, `backend/worker/src/mail.ts` |
| Four roles (OWNER, ADMIN, MEMBER, GUEST) | `shared/contracts/src/rbac.ts` |
| One declarative permission matrix, 30+ permissions | same |
| 404-not-403 for non-members | `backend/api/src/plugins/authz.ts` |
| Six per-workspace themes | `shared/contracts/src/themes.ts` |
| Tamper-evident audit trail: per-workspace sequence, chain signed with an HMAC key held outside the database, append-only by trigger and by the app's database role | `backend/database/src/audit.ts`, `audit-keys.ts`, `roles.ts` |
| Signed verification checkpoints, so a check walks only what is new; reads, exports and checks recorded | `backend/database/src/audit-checkpoints.ts`, `backend/api/src/routes/audit.ts` |
| Tombstone of a deleted workspace's trail (length and last hash) | migration 0017 |
| A six-slide tour at `/start` before sign-up: sourced quotes, a desk to sort, a tunnel that holds notes, trackpad swipes | `frontend/features/start/` |
| Security view for admins: filter, chain check, export as JSON lines | `frontend/features/security/` |
| SIEM stream over HTTPS, at-least-once with an idempotency key per event | `backend/worker/src/audit-stream.ts` |
| Emails shown only to admins; teammates see usernames | `backend/api/src/routes/members.ts` |
| No workspace access, over HTTP or the live feed, until a picture is chosen | `backend/api/src/plugins/authz.ts`, `backend/realtime/src/gateway.ts` |

A non-member gets **404, not 403**, because a 403 confirms the workspace
exists. Rules that depend on more than the actor's role (an admin may not
demote an owner; a workspace may not lose its last owner) live beside the data
they need rather than in the matrix.

## Projects and issues

| Feature | Where |
| --- | --- |
| Projects with generated keys (`REL-41`) | `backend/api/src/routes/projects.ts` |
| Issues: status, priority, assignee, description | `backend/api/src/routes/issues.ts` |
| Per-project issue numbering | same |
| Board view by status | `frontend/app/workspaces/[workspaceId]/projects/` |
| Comment threads with `@mentions` | `backend/api/src/routes/comments.ts` |
| Images on issues and comments: upload, camera, paste, members only | `backend/api/src/routes/attachments.ts`, `frontend/features/issues/attachments.tsx` |
| Images added offline wait on the device and upload exactly once | `shared/sync/src/engine.ts` |
| Storage port: local disk or any S3-compatible store, no public URLs | `backend/api/src/media/storage.ts` |
| Deleting an issue, comment or workspace queues removal of its files | `backend/database/src/files.ts`, `backend/worker/src/storage-purge.ts` |
| Offline data is bound to its account and cleared on sign-out | `shared/sync/src/engine.ts` |
| Keyset pagination | `backend/database/src/pagination.ts` |

## Chat

| Feature | Where |
| --- | --- |
| Workspace channels, unique name per workspace | `backend/api/src/routes/channels.ts` |
| `#general` created with every workspace, same transaction | `backend/api/src/routes/workspaces.ts` |
| Message history, paged backwards | `backend/api/src/routes/channels.ts` |
| Author deletes own, admin moderates any | same |
| Day separators and author grouping | `frontend/features/chat/message-list.tsx` |
| Realtime delivery | `shared/contracts/src/events.ts` |

Realtime chat events carry **ids only, never message bodies**. The client
re-reads each message through the authorised endpoint, so exactly one place
decides who may see what. It costs a round trip and buys a single
authorisation path.

## Documents

| Feature | Where |
| --- | --- |
| Collaborative editing via Yjs CRDTs | `shared/sync/`, `backend/realtime/` |
| Binary updates stored as `bytea` | `backend/database/src/schema.ts` |
| Append-only update log with compaction | `backend/database/src/documents.ts` |
| Live cursors and presence | `backend/realtime/src/presence.ts` |

## Meetings

| Feature | Where |
| --- | --- |
| Schedule with title, agenda, start, duration | `backend/api/src/routes/meetings.ts` |
| Invite attendees, intersected with the workspace roster | same |
| RSVP yes / no / maybe, always for the caller | same |
| Rescheduling clears everyone else's answer | same |
| Cancel marks the row rather than deleting it | same |
| Optional `https` join link | `shared/contracts/src/schemas.ts` |

Robis stores the plan and never the call. `joinUrl` is organiser-supplied and
validated as `https`, so Robis takes on no conferencing provider and no
third-party data flow. Invitee ids are intersected with the roster, which stops
a member attaching strangers and stops the endpoint confirming that a given
user id exists.

## Offline and sync

| Feature | Where |
| --- | --- |
| IndexedDB-backed durable mutation queue | `shared/sync/src/queue.ts` |
| Exactly-once via client ids plus a server ledger | `backend/api/src/plugins/idempotency.ts` |
| Optimistic board that works offline | `frontend/lib/use-offline-board.ts` |
| Service worker: network-first pages, cache-first assets | `frontend/public/sw.js` |
| Sync status indicator | `frontend/components/sync-status.tsx` |

The service worker never caches API or WebSocket traffic. It is off under
`next dev` unless `NEXT_PUBLIC_ENABLE_SW=1`, because dev chunk filenames are
stable rather than fingerprinted and a cache-first rule would serve stale
JavaScript.

## Search, notifications, jobs

| Feature | Where |
| --- | --- |
| Full-text search over issues, documents, comments | `backend/database/src/search.ts` |
| Stored generated `tsvector` columns | `backend/database/src/schema.ts` |
| Notification inbox with dedupe | `backend/api/src/routes/notifications.ts` |
| Mention notifications | `backend/worker/src/handlers.ts` |
| Stale-issue nudges | `backend/worker/src/nudges.ts` |
| `SKIP LOCKED` job queue with retries | `backend/database/src/queue.ts` |

## Operations

| Feature | Where |
| --- | --- |
| Prometheus `/metrics` on internal ports of the API and gateway, off the public ports | `backend/metrics/`, `backend/api/src/metrics.ts` |
| Route-pattern labels (cardinality-safe) | `backend/api/src/metrics.ts` |
| Health endpoints | `backend/api/src/app.ts` |
| Load harness | `scripts/bench/loadtest.ts` |
| Screenshot capture over CDP | `scripts/capture/screenshots.ts` |
| CI: lint, typecheck, test, build | `.github/workflows/ci.yml` |

## Machine learning

| Feature | Where |
| --- | --- |
| Duplicate issue detection (TF-IDF, cosine) | `robis-ml/robis_ml/model.py` |
| Priority triage (logistic regression) | same |
| Refuses to predict below 40 triaged issues | same |
| Repeated stratified k-fold against a stratified-random baseline | `robis-ml/robis_ml/evaluate.py` |
| Duplicate precision and recall on a labelled set, dev/test split | `robis-ml/robis_ml/duplicate_eval.py` |
| FastAPI service, per-workspace models | `robis-ml/robis_ml/service.py` |
| Shared bearer token, refuses to start without one | `robis-ml/robis_ml/auth.py` |
| Duplicate hints and a suggested priority in the issue composer | `backend/api/src/suggestions.ts` |

Advisory only. A missing or broken ML service degrades to no hints and never
blocks filing an issue.

---

## What it deliberately does not do

**Direct messages.** DMs need a different privacy story: who may read the
transcript, what an export contains, what happens when somebody leaves. Bolting
them onto a workspace-scoped table would answer those badly and silently.

**A public project directory with match percentages.** Robis workspaces are
private tenancies with invite-only membership, and the 404-not-403 rule is
tested. A public discovery surface would contradict that access model rather
than extend it.

**Conferencing.** Robis stores a link. It does not mint rooms, does not hold a
provider relationship, and does not put a third party in the request path.

**Any compliance claim.** The code does what is described here. That is not the
same as being certified, secure or compliant, and this document does not say it
is.

---

## Known gaps

| Gap | Why |
| --- | --- |
| Storage quotas | Uploads are rate-limited per account, but nothing caps how much a workspace stores |
| Attachments beyond images | Only images are accepted; PDFs and other files are not, because their metadata cannot be stripped the same way |
| Mail deliverability | Sent over SMTP and tested against a local SMTP server only. No provider has been tried, and there is no HTML version, bounce handling or unsubscribe |
| Deployment | Not done. The images are built and checked in CI, but nothing runs anywhere public yet |
| Duplicate detection, reworded intent | Finds 0 of 7 lexical-gap duplicates on the labelled set's test half |

The deployment gap waits on choosing a host and accounts. Attachments and duplicate recall are real
work that has not been done.
