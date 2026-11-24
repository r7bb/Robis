# Threat model: the newest surfaces

Uploads, stories, agents, workspace exports, outbound calls and tokens: what someone might
try, what stands in the way today, and what is left open. Written from the
code as it is (2026-11-22), not from a test by anyone outside the project,
so it describes what is checked, not a guarantee. The checks themselves
are in [SECURITY_CHECKS.md](SECURITY_CHECKS.md).

**Who might try.** A stranger on the internet with no account. Someone
with an account who is not in the workspace. A guest or member who wants
more than their role allows. A leaked agent token. A browser extension or
a compromised device of a member is out of scope: it holds that member's
session and can do what they can.

**What is worth protecting.** Each workspace's work and talk, kept from
other workspaces; who did what (the audit trail); accounts; and the server
itself, which must not be turned against its own network.

---

## Uploads

Pictures on issues, comments, chat and Feed posts, avatars, and story
photos.

| Threat | In the way today | Where |
| --- | --- | --- |
| A file that is not an image, or a decoder exploit | Only JPEG, PNG, WebP and AVIF are taken, at most 8 MB; each is decoded with a pixel limit and re-encoded, so what is stored is the server's own output, never the upload | `backend/api/src/media/images.ts`, `shared/contracts/src/images.ts` |
| Location or camera details leaking from a photo | Re-encoding drops every piece of metadata; orientation is applied first | `backend/api/src/media/images.ts` |
| A stored file opened as a page to run script | Files are served through the API with `default-src 'none'; sandbox`, `nosniff` and `Cross-Origin-Resource-Policy: same-origin` | `backend/api/src/hardening.ts` |
| Reading another workspace's pictures | Every picture route checks membership of the workspace the file belongs to; storage keys are random UUIDs under the workspace's prefix | `backend/api/src/routes/attachments.ts` |
| Filling the disk, or tying up the decoder | Per-account upload rates (30 a minute for attachments, 10 for avatars); decoding at capacity answers 503 rather than queueing without bound | same, and `routes/avatars.ts` |
| A deleted file left behind | Every delete queues the file's removal as a job, retried until it is gone | `backend/worker/src/storage-purge.ts` |

**Left open.** No storage quota per workspace, only per-account rates. No
virus scanning (pictures are re-encoded, and nothing else is accepted). A
file uploaded in the instant between a parent's lookup and its delete can
be missed by the purge.

## Stories

A photo or a few words, seen by the workspace for 24 hours.

| Threat | In the way today | Where |
| --- | --- | --- |
| A story outliving its 24 hours | Every route answers 404 once it is past, before the job that deletes the row and queues the file has run | `backend/database/src/stories.ts` |
| A guest using stories to reach the team socially | Guests see stories but cannot post them; an owner can turn stories off for the workspace, which hides them and refuses new ones | `shared/contracts/src/rbac.ts` |
| What was said living on in the trail | Posting and taking down are audited without the words | `backend/api/src/routes/stories.ts` |
| Photo metadata | As uploads, above | |

**Left open.** A member can screenshot a story; 24 hours is a convention
between people, not something software can enforce.

## Agents

Members of kind agent, acting with tokens, directly or through the MCP
server.

| Threat | In the way today | Where |
| --- | --- | --- |
| A leaked agent token used as an administrator | Agents can only be members or guests, never admins or owners, so a token cannot add people, remove them or make more agents | `shared/contracts/src/rbac.ts` (`AGENT_ROLES`) |
| A token reaching beyond its workspace | A token is honoured on its own workspace's routes only; account routes and the workspace list answer it as they answer nobody | `backend/api/src/plugins/authz.ts` |
| Stealing tokens from the database | Tokens are shown once and stored only as a hash; the worker's role cannot read the hash column | `backend/auth/src/agent-tokens.ts`, `backend/database/src/roles.ts` |
| The MCP server as a way round the API | It holds no authority of its own: every tool calls the API with the agent's own token, so the same permissions, rate limits and audit apply | `backend/mcp/` |
| The worker's own agents (triage, shots) kept in power | Each run mints a token that lasts five minutes and is revoked when the run ends | `backend/worker/src/triage.ts`, `shots.ts` |
| An agent's change going unnoticed | Every write is audited as an agent's; each change is recorded with the value before, can be undone in one click while nobody has changed it since, and is judged kept, edited or reverted after a week | `backend/database/src/agent-changes.ts` |
| An agent skewing the hint figures | Hint feedback refuses agents | `backend/api/src/routes/feedback.ts` |
| A prompt-injected agent | Robis runs no model on agents' behalf by default; an agent outside Robis is as trustworthy as whoever runs it, and is bounded by its role above | |

**Left open.** A member-role agent can do anything a member can,
including deleting issues; there is no narrower agent role yet. Revoking a
token is immediate, but a request already in flight finishes.

## Workspace exports and imports

An admin can take everything a workspace holds out of Robis as one zip,
and a member can bring issues in from a CSV file or such a zip (C6). The
export is the largest single read in the app and the import the largest
single write, so both are fenced in.

| Threat | In the way today | Where |
| --- | --- | --- |
| Someone outside the workspace, or a member, getting the file | Asking, making a link and downloading all need `workspace:export` (admins and owners); agents can never hold it; every query is scoped to the workspace in the path | `backend/api/src/routes/exports.ts`, `shared/contracts/src/rbac.ts` |
| A copied, logged or prefetched link | The link is a 256-bit token stored only as a hash; it lasts five minutes, works once and only with an admin's session; HEAD and cross-site requests are refused; the token is replaced in logged URLs | same, and `backend/api/src/plugins/tracing.ts` |
| Credentials or addresses travelling in the file | Webhook secrets are dropped and webhook addresses cut to their origin; members appear by name and username, never email; storage keys and search indexes stay behind | `backend/api/src/exports/build.ts` |
| The file outliving the workspace or the need | Purged half an hour after its download, after seven days if never fetched, and with its workspace or its owner's account | `backend/api/src/exports/job.ts`, `backend/database/src/files.ts` |
| A crafted import file | CSV and export files are size-limited as they stream in; every export line is validated against the schema (statuses and priorities from the fixed lists, lengths capped); ids are bounded or hashed; labels, comments and issues per import are capped; an import is one transaction under a per-board lock, and needs the role that makes labels | `backend/api/src/imports/`, `backend/storage/src/zip.ts` |
| One build exhausting the API | Capped at 256 MB, checked against stored file sizes before anything is read; one build at a time per API instance, on a loop of its own | `backend/api/src/exports/build.ts`, `backend/api/src/automation/runner.ts` |

**Left open.** The export is built in memory inside the API process, so
the cap bounds it rather than streaming it. Meeting join links travel as
members see them, and may carry a passcode.

## Outbound calls

Robis has no inbound webhooks: nothing outside calls in except people's
browsers and agents with tokens. It does call out, and each call could be
turned against the server's own network if its address came from a user.

| Call | Who chooses the address | In the way today | Where |
| --- | --- | --- | --- |
| The audit stream to a SIEM | The operator, in `AUDIT_STREAM_URL`; never a workspace | HTTPS only (plain HTTP only to localhost), no credentials in the URL, a bearer token apart from it | `backend/worker/src/audit-stream.ts` |
| Web push | The browser, so the client | Only the browsers' own push services (Google, Mozilla, Apple, Microsoft hosts), HTTPS on the default port; at most ten devices per account; a push carries no content, only a nudge to look | `shared/contracts/src/push.ts` |
| The pictures agent | Robis, from a fixed list | HTTPS to named hosts only (NASA, Wikimedia Commons, Openverse); nothing about the workspace is sent | `backend/worker/src/pictures/` |
| A rule's webhook (B9) | An administrator, per rule | HTTPS on the default port only; every address the name resolves to must be global (IPv4 outside every reserved range, IPv6 only in global unicast and not 6to4, NAT64, Teredo or documentation; an IPv4 address written as IPv6 is judged as the IPv4 address it is); the name must resolve within three seconds; no redirects followed; five seconds; the body holds ids, never words, signed with a secret the server made for that rule. Left open: the name is resolved for the check and again to connect, so DNS rebinding between the two is not caught | `backend/worker/src/webhook.ts` |
| A workspace webhook (C7) | An administrator, per webhook | As a rule's webhook: HTTPS on the default port, every resolved address public, no redirects, five seconds; the body holds ids and an issue's key and status, never words, and only events the webhook's maker can still read; signed over a timestamp and the body, with a delivery id for dropping repeats. Left open: the same DNS rebinding gap as above | `backend/worker/src/workspace-webhook.ts` |
| A GitHub issue import (C6) | A member, choosing the repository; the host is fixed | Only `https://api.github.com`; the repository name is checked as owner/name and may not be `.` or `..`; ten seconds a request and a bounded number of pages; the person's token goes only to GitHub, for that import, and is never stored or logged | `backend/api/src/imports/github.ts` |
| The ML service | The operator | Inside the network, behind a service token | `backend/api/src/suggestions.ts` |
| A language-model summary | The operator, and only when a provider key is set and an admin turns it on for the triage agent | Off by default; when on, sends an issue's text to the provider, as the setting's own description says | `backend/worker/src/summary-provider.ts` |

**Left open.** Inbound webhooks for integrations (C7) are not built; when
they are, each needs its own signature check and replay window before it
is enabled.

## Tokens

| Token | Stored as | Lifetime | Where |
| --- | --- | --- | --- |
| Session cookie | a hash; the cookie is HttpOnly, SameSite=Lax, `__Host-` and Secure in production | until it expires or is signed out; "sign out everywhere" ends the rest | `backend/auth/src/sessions.ts`, `backend/api/src/session-cookie.ts` |
| Password reset link | a hash, single use | 30 minutes | `backend/auth/src/auth-tokens.ts` |
| Sign-up and verification link | a hash, single use | 24 hours | same |
| "Not me" link from a new-browser email | a hash | 7 days | same |
| Two-factor challenge (between password and code) | a hash | short-lived, removed once expired | `backend/auth/src/two-factor.ts` |
| Authenticator secret | sealed with `TWO_FACTOR_KEY` | while two-factor is on | same |
| Agent token | a hash, shown once | until revoked; the worker's run tokens five minutes | `backend/auth/src/agent-tokens.ts` |
| Audit signing keys | the operator's secret store, by key id | rotated by the operator | `backend/database/src/audit-keys.ts` |

| Threat | In the way today |
| --- | --- |
| Guessing a token | Every one is random; sign-in, sign-up and reset are rate-limited per address and per network, across every API instance (A6) |
| A token in a URL leaking by Referer or cache | Token pages send `no-referrer` and `no-store` |
| Cross-site writes riding a session | A write from another origin is refused before its body is read, whatever it carries; SameSite=Lax as well |
| A stolen database dump | Sessions, links and agent tokens are hashes; authenticator secrets are sealed with a key kept apart |

**Left open.** No hardware-bound sessions. A reset link's 30 minutes is a
window someone reading the inbox has too.

---

## The demo

`demo:life` signs the seeded teammates in with the public demo password
and creates agents. It is bounded by the same rules as anyone: the API
refuses that password outside development, and the runner refuses any
address that is not this machine or the compose network.

## Review

This model should be read again whenever one of these surfaces changes,
and checked against the first real incident. Marked as a draft: nothing
in it has been reviewed by a security professional.
