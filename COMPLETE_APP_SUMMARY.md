# Relay: complete feature inventory

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
| Tests | 393 TypeScript, 17 Python |
| Screenshots | 28, all captured from the running app |
| Measured throughput | ~4,400 req/s, zero errors |

---

## Accounts and access

| Feature | Where |
| --- | --- |
| Register, sign in, sign out | `backend/api/src/routes/auth.ts` |
| Argon2id password hashing | `backend/auth/src/passwords.ts` |
| Opaque server-side sessions (SHA-256 token hash) | `backend/auth/src/sessions.ts` |
| Login timing equalisation | `backend/api/src/routes/auth.ts` |
| Password reset by email, single-use token | `backend/api/src/routes/auth-recovery.ts` |
| Email verification | same |
| Change name, change password | `backend/api/src/routes/account.ts` |
| Rate limiting, per caller and per recipient address | `backend/api/src/plugins/rate-limit.ts` |

Sessions are opaque rather than JWTs so that changing a password kills every
existing session immediately. Reset tokens are stored only as a SHA-256 hash,
expire in 30 minutes, and are spent by `DELETE … RETURNING`, so there is no
second "consumed" state to get wrong.

## Workspaces, roles and tenancy

| Feature | Where |
| --- | --- |
| Create workspaces, invite members, set roles | `backend/api/src/routes/workspaces.ts`, `members.ts` |
| Four roles (OWNER, ADMIN, MEMBER, GUEST) | `shared/contracts/src/rbac.ts` |
| One declarative permission matrix, 30+ permissions | same |
| 404-not-403 for non-members | `backend/api/src/plugins/authz.ts` |
| Six per-workspace themes | `shared/contracts/src/themes.ts` |
| Append-only audit trail | `audit_events` table |

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

Relay stores the plan and never the call. `joinUrl` is organiser-supplied and
validated as `https`, so Relay takes on no conferencing provider and no
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
| Prometheus `/metrics` on API and gateway | `backend/metrics/` |
| Route-pattern labels (cardinality-safe) | `backend/api/src/metrics.ts` |
| Health endpoints | `backend/api/src/app.ts` |
| Load harness | `scripts/loadtest.ts` |
| Screenshot capture over CDP | `scripts/screenshots.ts` |
| CI: lint, typecheck, test, build | `.github/workflows/ci.yml` |

## Machine learning

| Feature | Where |
| --- | --- |
| Duplicate issue detection (TF-IDF, cosine) | `relay-ml/relay_ml/model.py` |
| Priority triage (logistic regression) | same |
| Refuses to predict below 40 triaged issues | same |
| Macro-F1 against a majority-class baseline | `relay-ml/relay_ml/evaluate.py` |
| FastAPI service, per-workspace models | `relay-ml/relay_ml/service.py` |

Advisory only. Not wired into the API, and **unauthenticated**, so it is not
deployable as it stands.

---

## What it deliberately does not do

**Direct messages.** DMs need a different privacy story: who may read the
transcript, what an export contains, what happens when somebody leaves. Bolting
them onto a workspace-scoped table would answer those badly and silently.

**A public project directory with match percentages.** Relay workspaces are
private tenancies with invite-only membership, and the 404-not-403 rule is
tested. A public discovery surface would contradict that access model rather
than extend it.

**Conferencing.** Relay stores a link. It does not mint rooms, does not hold a
provider relationship, and does not put a third party in the request path.

**Any compliance claim.** The code does what is described here. That is not the
same as being certified, secure or compliant, and this document does not say it
is.

---

## Known gaps

| Gap | Why |
| --- | --- |
| File uploads | No object storage available on this machine |
| Verified container build | No Docker available |
| Production mail driver | No SMTP. The API refuses to boot in production without one rather than printing reset links to a log |
| Deployment | Follows from the above |
| ML service auth | Takes a workspace id from the URL and trusts it |
| ML evaluation rigour | Single split rather than repeated k-fold; no labelled duplicate set |

The first four are environment constraints and are stated rather than
disguised. The last two are real work that has not been done.
