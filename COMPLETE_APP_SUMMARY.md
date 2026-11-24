# Robis: complete feature inventory

Everything the application does today, what it deliberately does not do, and
where each thing lives. [The README](README.md) is the short tour;
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) is the reasoning.

Written to be checkable. Every row names a file you can open.

---

## At a glance

| | |
| --- | --- |
| Services | 5 (web, API, realtime gateway, worker, MCP server for agents) plus an optional ML service |
| Database tables | 18 |
| HTTP endpoints | 230 |
| Tests | Counted in [docs/ROADMAP.md](docs/ROADMAP.md), the one place they are kept |
| Screenshots | 35, all captured from the running app |
| Measured throughput | ~3,600 req/s, zero errors |

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
| Two-factor sign-in with an authenticator app: QR set-up, codes that work once in their window, ten recovery codes kept only as hashes, secrets sealed with a key outside the database | `backend/auth/src/totp.ts`, `backend/auth/src/two-factor.ts`, `backend/api/src/routes/two-factor.ts`, `frontend/features/account/two-factor.tsx` |
| Password reset by email, single-use token | `backend/api/src/routes/auth-recovery.ts` |
| Email verification | same |
| Change name, username or password | `backend/api/src/routes/auth.ts` |
| Rate limiting, per caller (IPv6 by its /64) and per recipient address, with growing waits after wrong passwords; counted in Postgres in production, so every API instance shares one budget | `backend/api/src/plugins/rate-limit.ts`, `backend/api/src/plugins/rate-store.ts`, `backend/api/src/plugins/sign-in-waits.ts` |
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
| Live home after sign-in on one screen: field that ripples with live events, Today (assigned to you, mentions, today’s meetings across workspaces), the latest live event, workspace tiles with activity and presence | `frontend/app/workspaces/page.tsx`, `frontend/features/home/`, `backend/api/src/routes/overview.ts` |
| Create workspaces, invite members, set roles | `backend/api/src/routes/workspaces.ts`, `members.ts` |
| Invitations the invited person accepts or declines; joining needs a confirmed email | `backend/api/src/routes/invitations.ts`, `frontend/components/my-invitations.tsx` |
| Email invitations that answer the same whether or not the address has an account; cap per sender | `backend/api/src/routes/invitation-helpers.ts`, `backend/worker/src/mail.ts` |
| A workspace can require two-factor sign-in of everyone: members without it are refused on every workspace route and the live feed (open tabs are cut off within 30 seconds), its notices, meetings, mail and pushes are held back from them, and its admins keep their own two-factor on | `backend/api/src/plugins/authz.ts`, `backend/realtime/src/gateway.ts`, `frontend/features/workspace/two-factor-policy.tsx` |
| Growing waits after wrong passwords: per address and network address the fifth starts a 30 second wait, doubling to 15 minutes, with a looser hourly cap per address from anywhere; counted before the password is checked, alike for addresses with and without an account, cleared by a right password or a reset | `backend/api/src/plugins/sign-in-waits.ts`, `backend/api/src/routes/auth.ts` |
| An email on a sign-in from a new browser (a random per-browser cookie, kept as a hash), with a one-time link to a page that signs out everywhere and forgets every browser | `backend/auth/src/devices.ts`, `backend/api/src/session-cookie.ts`, `backend/worker/src/mail.ts`, `frontend/app/not-me/page.tsx` |
| Passkeys: add from the account page, sign in without a password or address; user verification required, so a passkey sign-in counts as two factors; @simplewebauthn 14.0.x | `backend/api/src/routes/passkeys.ts`, `backend/auth/src/passkeys.ts`, `frontend/features/account/passkeys.tsx`, `frontend/app/login/passkey-button.tsx` |
| Four roles (OWNER, ADMIN, MEMBER, GUEST) | `shared/contracts/src/rbac.ts` |
| One declarative permission matrix, 30+ permissions | same |
| 404-not-403 for non-members | `backend/api/src/plugins/authz.ts` |
| Eight per-workspace themes: five dark, Daylight, and two tinted light ones (Mist, Meadow) that are not all white, each held to 4.5:1 | `shared/contracts/src/themes.ts` |
| Tamper-evident audit trail: per-workspace sequence, chain signed with an HMAC key held outside the database, append-only by trigger and by the app's database role | `backend/database/src/audit.ts`, `audit-keys.ts`, `roles.ts` |
| Signed verification checkpoints, so a check walks only what is new; reads, exports and checks recorded | `backend/database/src/audit-checkpoints.ts`, `backend/api/src/routes/audit.ts` |
| Tombstone of a deleted workspace's trail (length and last hash) | migration 0017 |
| A six-slide tour at `/start` before sign-up: sourced quotes, a desk to sort, a tunnel that holds notes, trackpad swipes | `frontend/features/start/` |
| Security view for admins: filter, chain check, export as JSON lines | `frontend/features/security/` |
| SIEM stream over HTTPS, at-least-once with an idempotency key per event | `backend/worker/src/audit-stream.ts` |
| Emails shown only to admins; teammates see usernames | `backend/api/src/routes/members.ts` |
| No workspace access, over HTTP or the live feed, until a picture is chosen | `backend/api/src/plugins/authz.ts`, `backend/realtime/src/gateway.ts` |
| Agents marked wherever they appear (team list, members, comments, activity, an issue's delegate); admins manage, rename and give tokens to agents from the Team panel, a token shown once | `frontend/components/agent-list.tsx`, `frontend/components/ui/primitives.tsx` |
| Watching agents: every agent call recorded as a step of a run (tool, outcome, time, never what was sent), changes judged kept, edited or reverted after seven days, MCP tool metrics, an admin page of runs and counts, and one-click undo of an agent’s change while nobody has changed it since | `frontend/features/agents/`, `backend/database/src/agent-runs.ts`, `agent-changes.ts`, `backend/mcp/src/metrics.ts` |
| Hint feedback: using or setting aside a duplicate or priority hint counted with no person named, beside the offline evaluation | `backend/api/src/routes/feedback.ts`, `frontend/features/issues/` |
| A scripted triage agent: on each new issue it comments suggested duplicates and a priority with their scores, through the MCP server with a five-minute token, and changes nothing | `backend/worker/src/triage.ts` |
| An MCP server for agents at `/mcp/<workspace id>`: search, suggest, list projects, read, create and update issues, comment; it holds no authority and calls the API with the agent's own token | `backend/mcp/` |
| Stories: a photo or a few words, seen by the workspace for 24 hours and a 404 on every route after, before the job that deletes the row and queues the file has run; photos re-encoded without metadata and served to members only; posting and taking down audited without the words; an owner can turn them off, which hides them and refuses new ones. In the app: a strip atop the chat, rings on pictures, a full-screen viewer and a composer (photo chosen, taken or pasted, or words); a photo posted offline posts once on reconnect | `backend/api/src/routes/stories.ts`, `backend/database/src/stories.ts`, `frontend/features/stories/`, `shared/sync/src/engine.ts` |
| Project health on the Feed: a card per active project with open, done this week, overdue and urgent, and a state from written rules (needs a look, on track, quiet, finished) in words, never colour alone; worked out from the issues on each read, with done stamped by a database trigger | `backend/api/src/routes/feed-highlights.ts`, `backend/api/src/feed/health.ts`, `frontend/features/feed/project-health.tsx` |
| Insights: each active project's median cycle time with its spread (half took between, one in ten over) and the number of issues behind it, and twelve weeks of throughput, from the status changes in the audit trail; below ten finished issues the counts and no figures. Rules written on the page; nothing stored | `backend/api/src/insights/flow.ts`, `backend/api/src/routes/insights.ts`, `frontend/features/insights/` |
| System health on Insights: for workspace admins, a month of hint acceptance (used out of answered, from ten answers); for the server's operators (`HEALTH_OPERATORS`), the job queue and a day of sync lag and live-update latency, timed as the services work and kept as bucket counts per minute that add across instances, shown as bucket edges with the count behind them | `backend/database/src/instruments.ts`, `backend/api/src/plugins/sync-lag.ts`, `backend/api/src/insights/health.ts`, `frontend/features/insights/health-view.tsx` |
| Celebrations on the Feed: a project finished, a 10th (25th...) issue done, an anniversary, a new teammate, from the last seven days, with Say well done starting a post and Celebrate, Support and Thanks reactions kept against the milestone's stable id; never for agents or anyone who opted out on their profile, a choice only they can see | `backend/api/src/feed/celebrations.ts`, `backend/api/src/routes/feed-highlights.ts`, `frontend/features/feed/celebrations.tsx` |
| Spaces: topics within the workspace where a question, idea, discussion or tip gets a thread; replies nest six deep; whoever asked (or an admin) marks the answer; reactions on threads and replies; sort by active, new, top or unanswered; Most helpful this week, month or of all time, counting Helpful marks and answers from other people only; live updates, audited, in the export | `backend/api/src/routes/spaces.ts`, `backend/api/src/spaces/`, `frontend/features/spaces/` |
| A picture a day from public image libraries (NASA, Wikimedia Commons, Openverse): an agent posts an openly licensed, credited picture, sometimes as a meme drawn by Robis; HTTPS to named hosts only, nothing sent | `backend/worker/src/pictures/` |
| A weekly check-in on the Feed: the answer is a post and your profile's Working on line; optional, no streaks, nobody told who has not answered | `backend/api/src/routes/posts.ts`, `frontend/features/feed/check-in.tsx` |
| Different shots: a chosen agent posts an idea a day as a story with a Try it that opens a place in Robis, scripted from a written list, through the MCP tool post_shot with a one-run token | `backend/worker/src/shots.ts`, `backend/mcp/src/tools.ts` |
| Your day at the top of the feed: what is overdue and due today for you in this workspace, and how many more this week; the home shows the same across workspaces | `backend/api/src/routes/today.ts`, `frontend/features/feed/your-day.tsx` |
| Assistance, off by default: Summarise a thread or channel with each point linked to its sources, Draft agenda from the issues a meeting names, Make an issue from a chat message; needs the server's provider key and an admin's switch; marked as generated; saved only by a person's button; each ask a short-lived request the worker answers and clears | `backend/api/src/routes/assist.ts`, `backend/worker/src/assist-job.ts`, `frontend/features/assist/` |
| Who is where: faces beside each board and document in the sidebar for whoever has it open, and agents able to edit documents live from a server with their token (never from a browser) | `frontend/features/workspace/here-stack.tsx`, `backend/realtime/src/gateway.ts` |
| A feed in two tabs: Following (only the people and spaces you follow, and you, newest first) and Everyone (the workspace less anyone you muted, with the check-in, Different shots, celebrations and project health above the posts), under a Here now strip of who is online, on which board, and the agents at work; follow from a post, a profile, the People page or an empty Following tab; follow a space and its new threads come to Following (whoever starts a space follows it); following and muting are yours alone, nobody is told | `backend/api/src/routes/follows.ts`, `frontend/features/feed/feed-tabs.tsx`, `frontend/features/feed/follow-button.tsx` |
| A feed that ends: posts of words or photos with five reactions (Celebrate, Helpful, Support, Thanks, Insightful; faces, not totals) and comments, pictures from rooms mixed in, newest first a page at a time, ending at "You're all caught up" with older posts behind Show earlier | `backend/api/src/routes/feed.ts`, `backend/api/src/routes/posts.ts`, `frontend/features/feed/` |
| Pictures in chat: a pasted screenshot or a photo (chosen, or taken with the camera on phone or desktop) posts as its own message, stripped, members only, audited, counted in storage, removed with its message, room or workspace | `backend/api/src/routes/message-images.ts`, `frontend/features/chat/picture-buttons.tsx` |
| Profiles, per workspace: a title, a "working on" line and a cover photo (members only, removed with the membership), recent work of the kinds the viewer may read, and a grid of the images they shared; your own to edit | `backend/api/src/routes/profiles.ts`, `backend/api/src/profile-activity.ts`, `frontend/features/profiles/` |
| Agents as workspace members (member or guest only) with revocable bearer tokens, shown once and kept as hashes; recorded as agents in the audit trail and as the delegate on issues they touch, never as an assignee | `backend/api/src/routes/agents.ts`, `backend/auth/src/agent-tokens.ts` |

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
| Board view by status | `frontend/features/board/project-board.tsx` |
| Comment threads with `@mentions` | `backend/api/src/routes/comments.ts` |
| Images on issues and comments: upload, camera, paste, members only | `backend/api/src/routes/attachments.ts`, `frontend/features/issues/attachments.tsx` |
| Images added offline wait on the device and upload exactly once | `shared/sync/src/engine.ts` |
| Storage port: local disk or any S3-compatible store, no public URLs | `backend/storage/src/index.ts` (`@robis/storage`) |
| Deleting an issue, comment or workspace queues removal of its files | `backend/database/src/files.ts`, `backend/worker/src/storage-purge.ts` |
| Offline data is bound to its account and cleared on sign-out | `shared/sync/src/engine.ts` |
| Keyset pagination | `backend/database/src/pagination.ts` |
| Typed route contracts: the API serves, the web app calls and OpenAPI describes each route from one definition | `shared/contracts/src/http/`, `backend/api/src/contract.ts`, `docs/openapi.json` |

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
| A first run for new accounts: name a workspace or accept an invitation, pick its look and invite a teammate, start a first project from a template (software, event planning, coursework) with five starter issues | `frontend/features/first-run/`, `shared/contracts/src/project-templates.ts` |
| Empty views that say what goes there, with the one button that fills them and a link to the matching guide | `frontend/components/empty-view.tsx`, `frontend/lib/empty-views.ts` |
| A demo workspace from the first run: a board of example issues, a document, a channel and a meeting, labelled Demo, one per person | `backend/api/src/workspaces/demo.ts`, `shared/contracts/src/demo-workspace.ts` |
| Workspace export for admins: everything the workspace owns as JSON lines plus its images, in a zip built by a job, downloaded once through a five-minute single-use link, each step audited | `backend/api/src/exports/`, `backend/api/src/routes/exports.ts`, `backend/storage/src/zip.ts` |
| Issue import into a board from a CSV file, a Robis export or a GitHub repository, statuses and labels mapped, a rerun adding nothing | `backend/api/src/imports/`, `backend/api/src/routes/imports.ts`, `frontend/features/imports/` |
| Outgoing webhooks per workspace: chosen events, HMAC-signed deliveries with an idempotency id, retries with backoff, a delivery log for admins | `backend/api/src/routes/webhooks.ts`, `backend/worker/src/workspace-webhook.ts` |
| Personal access tokens for the REST API: read or read and write, shown once, stored hashed, revocable, last use shown, workspace routes only | `backend/auth/src/personal-tokens.ts`, `backend/api/src/routes/personal-tokens.ts`, `frontend/features/account/api-tokens.tsx` |
| GitHub pull requests on issues: a signed webhook links pull requests by the issue key in their title or branch, shows their state, and can move the issue to done on merge | `backend/api/src/github/pull-requests.ts`, `backend/api/src/routes/github.ts` |
| An API reference (docs/API.md) and OpenAPI document written from the route contracts, the document also served at /api/openapi.json | `shared/contracts/src/http/reference.ts`, `scripts/docs/openapi.ts` |
| Installable on a phone: a web app manifest, generated icons (maskable and Apple), and every page checked at phone width | `frontend/app/manifest.ts`, `scripts/brand/icons.ts`, `scripts/journeys/phone.ts` |
| Issues and comments offline: kept answers in IndexedDB, comments written offline queued and sent once on reconnect; chat online only, and saying so | `frontend/lib/remembered.ts`, `frontend/lib/use-pending-comments.ts`, `shared/sync/src/engine.ts` |
| Share to Robis from a phone: the manifest's share target, caught by the service worker offline or on, made into an issue with photos and a comment through the offline queue | `frontend/public/sw.js`, `frontend/features/share/share-view.tsx` |
| Accessibility checked by axe-core on every captured page and theme in CI, failing on serious findings; theme contrast held to 4.5:1 by tests | `scripts/journeys/a11y.ts`, `tests/themes.test.ts` |
| Languages: English and Spanish from typed message files (every key, placeholder and plural pair checked), chosen on the account page or from the browser, with the page's lang set; every date, time and number formatted in the viewer's locale through one module; shell, calendar and Spaces translated so far | `frontend/lib/i18n/`, `docs/LANGUAGES.md` |
| Automation rules (Automations, for admins): a trigger from the audit trail, conditions that must all hold, one action (status, priority, assign, comment, notify, post in a channel, an outgoing webhook signed per rule to public https addresses only); run once per change on the API's own job runner, never on a rule's own change, chains stopped three deep with a note; the trail names the rule | `backend/api/src/automation/`, `backend/api/src/routes/automations.ts`, `backend/worker/src/webhook.ts`, `frontend/features/automations/` |
| A week view (Calendar): the month and ISO week, today marked, a line for now that moves each minute, each meeting in its own colour week after week, weekends shaded; meetings and repeats in the viewer's zone, overlaps side by side, issues due each day along the top, a list of days on a phone | `frontend/features/calendar/`, `backend/api/src/routes/week.ts` |
| Meetings imported from an .ics file: timed events in UTC, a named zone or floating time, weekly repeats with a count or end, invitees matched to the roster by address for admins only; anything else left out with a reason | `backend/api/src/calendar/parse.ts`, `backend/api/src/routes/calendar-import.ts`, `frontend/features/meetings/import-calendar.tsx` |
| A private calendar feed per person (Account, Calendar feed): every meeting they are in, each weekly occurrence its own event at its UTC instant, revocable, a 404 once revoked; weekly repeats kept at the organiser's wall-clock time across clock changes | `backend/api/src/routes/calendar.ts`, `backend/api/src/calendar/ics.ts`, `shared/contracts/src/calendar.ts` |
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
| Full-text search over issues, documents, comments, chat messages, space threads and replies, and meetings | `backend/database/src/search.ts` |
| Stored generated `tsvector` columns | `backend/database/src/schema.ts` |
| Notification inbox with dedupe | `backend/api/src/routes/notifications.ts` |
| Snooze and Remind me: an entry put off waits under Later and comes back unread; a reminder of an issue, message or thread is a snoozed note to yourself, pushed at its time; times in plain words | `backend/api/src/routes/reminders.ts`, `shared/contracts/src/when.ts`, `frontend/components/inbox-entry.tsx` |
| Sapha in the command palette: plain requests read in the browser into a dozen intents (status, priority, assignee, due day, new issue, reminder, meeting, open, search, go), changes shown on a card and done as the person only after Do it | `shared/contracts/src/sapha.ts`, `frontend/features/sapha/` |
| Chat that keeps your place: unread counts per room, a New line, marking read while in view, and quick reactions on messages | `backend/api/src/routes/chat-reads.ts`, `frontend/features/chat/use-reads.ts`, `frontend/features/chat/message-reactions.tsx` |
| Asked before? Up to five threads sharing two or more words with a draft title, answered first | `backend/api/src/spaces/similar.ts`, `frontend/features/spaces/asked-before.tsx` |
| Meeting notes: written by whoever is in the meeting, a save over a newer one refused; checklist, TODO and Action lines are follow-ups filed as issues and ticked with their key | `backend/api/src/meetings/notes.ts`, `shared/contracts/src/follow-ups.ts`, `frontend/features/meetings/meeting-notes.tsx` |
| Document history: a version kept as a document changes (at most every ten minutes, the latest fifty), read whole and put back as one edit after the current text is kept | `backend/database/src/documents.ts`, `backend/api/src/routes/document-versions.ts`, `frontend/features/documents/document-history.tsx` |
| Space notifications: a reply tells the thread's author and the reply it answers, a marked answer tells its author once; stale news tells no one | `backend/worker/src/notify-spaces.ts` |
| Mention notifications | `backend/worker/src/handlers.ts` |
| Stale-issue nudges | `backend/worker/src/nudges.ts` |
| `SKIP LOCKED` job queue with retries | `backend/database/src/queue.ts` |

## Operations

| Feature | Where |
| --- | --- |
| Prometheus `/metrics` on internal ports of the API, gateway, MCP server and worker, off the public ports; the worker reads the queue and the audit stream's lag at each scrape | `backend/metrics/`, `backend/api/src/metrics.ts`, `backend/worker/src/metrics.ts` |
| Traces across every service with OpenTelemetry: a request, the jobs it queued and the mail they sent are one trace, through the realtime fan-out and the ML service too | `backend/telemetry/`, `backend/api/src/plugins/tracing.ts`, `robis-ml/robis_ml/telemetry.py` |
| Structured JSON logs in every service, each line naming its trace | `backend/telemetry/src/log.ts` |
| Security checks in CI: Trivy over the repository and every image, an OWASP ZAP baseline scan of the stack with its findings triaged, a strict nonce policy with a deny-all fallback at the proxy, and cross-origin isolation headers | `.github/workflows/ci.yml`, `deploy/zap/baseline.conf`, `deploy/caddy-routes`, `docs/SECURITY_CHECKS.md` |
| Alert rules with promtool tests in CI, and a runbook for each | `deploy/prometheus/`, `docs/RUNBOOK.md` |
| Route-pattern labels (cardinality-safe) | `backend/api/src/metrics.ts` |
| Health endpoints | `backend/api/src/app.ts` |
| Load harness, run in CI against the last three main runs with a margin from their spread, and a soak test (1,000 sockets, 30 minutes) | `scripts/bench/` |
| Failure drills in CI: the worker killed mid-burst, the gateway killed under an open board, Postgres restarted under writes, the ML service stopped; each recovers with no write lost and nothing done twice | `scripts/drills/run.ts` |
| Screenshot capture over CDP | `scripts/capture/screenshots.ts` |
| A lively demo: the seeded teammates stay present and, with two agents (a triage agent and a Different shots agent), chat, post, react, comment, file and move issues every half minute or so, from written lines, through the API; development only, in compose under `--profile demo` | `scripts/demo/` |
| Browser journeys in real Chrome against the container stack, in CI on every push and pull request: sign-up through the mail sink, an offline board write and reconnect, two people on one document, chat delivery, a reschedule clearing answers, a guest with no write controls, a stranger getting not found | `scripts/journeys/` |
| CI: lint, typecheck, test, build | `.github/workflows/ci.yml` |

## Machine learning

| Feature | Where |
| --- | --- |
| Duplicate issue detection: MiniLM sentence embeddings on the CPU (ONNX Runtime, weights hash-checked at image build), word TF-IDF as the fallback; cosine nearest neighbours | `robis-ml/robis_ml/model.py`, `robis-ml/robis_ml/embeddings.py` |
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

## Where the rest is written

Kept in one place, [docs/ROADMAP.md](docs/ROADMAP.md): what is left, the
known gaps, and what Robis deliberately does not do. This document is the
inventory of what exists; the reasoning is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). What is checked for security,
and the ZAP triage, is in [docs/SECURITY_CHECKS.md](docs/SECURITY_CHECKS.md);
the threat model for uploads, stories, agents, outbound calls and tokens in
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md); how to report a problem in
[SECURITY.md](SECURITY.md).
