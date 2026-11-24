# Security checks

What is checked, where, and what the checks found. None of this makes
Robis secure: each check finds one kind of problem, and only that kind.
The threat model for the newest surfaces is in
[THREAT_MODEL.md](THREAT_MODEL.md); how to report a problem is in
[SECURITY.md](../SECURITY.md).

## In CI, on every push and pull request

| Check | What it looks at | Fails the build when |
| --- | --- | --- |
| Trivy, the repository | every lockfile (`bun.lock`, the Python locks) and every committed file, on the fresh checkout | a critical vulnerability with a fix, or anything that looks like a secret |
| Trivy, the images | all seven built images, handed over as tarballs | the same, inside an image's layers |
| Image contents | each image's installed packages and files | an image holds another service's dependencies, a source map or an `.env` file |
| Browser smoke test | the web app in real Chrome under its own policy | a Content-Security-Policy violation, a page that does not hydrate, a missing security header, or an injected script that runs |
| OWASP ZAP baseline | a passive two-minute spider of the stack's public pages, judged by [`deploy/zap/baseline.conf`](../deploy/zap/baseline.conf) | a rule marked FAIL matches (below) |
| Browser journeys | sign-up, offline sync, two people on one document, chat, meetings, a guest, a stranger | a guest sees a write control, or a stranger gets anything but not found |
| Dependabot | the pinned base images | (it opens a pull request with a new digest; CI then scans it) |

The test suite covers the authorisation rules themselves (a non-member
gets 404, a member without a permission 403) route by route, and the
rate limits, the audit chain and the token handling.

## The Content Security Policy

Every page gets a policy with a fresh nonce per request (`frontend/middleware.ts`):
scripts only from this origin and only with the nonce, `strict-dynamic`, no
`unsafe-inline` or `unsafe-eval` for scripts, no framing, forms only to this
origin. The WebGL landing page runs under it; the browser smoke test loads
it and fails on any violation. Anything the web app serves without a policy
of its own (static files, a 404 for a file name) gets one from the edge
proxy that allows nothing, except the service worker, whose own policy
comes from its response and would otherwise stop it fetching. The API's
responses carry `default-src 'none'; sandbox`, so nothing it returns can
run if opened directly.

Pages and files also carry `Cross-Origin-Resource-Policy: same-origin`,
`Cross-Origin-Embedder-Policy: require-corp` and
`Cross-Origin-Opener-Policy: same-origin`. Every page loads only this
origin's files, so this costs nothing the browser tests could find.

## ZAP baseline: the triage

First run against the compose stack on 2026-11-22 (ZAP 2.17.0, passive
rules only): no failures, nine kinds of warning. What happened to each:

| Rule | Finding | Decision |
| --- | --- | --- |
| 10037 | `X-Powered-By: Next.js` on every page | **Fixed** (`poweredByHeader: false`); now a FAIL rule |
| 10038 | No policy on `/robots.txt` and `/sitemap.xml` (404s the middleware skips) | **Fixed** at the edge proxy, and a real `robots.txt` added; now a FAIL rule |
| 90004 | No `Cross-Origin-Resource-Policy`, then no `Cross-Origin-Embedder-Policy` | **Fixed** with the three cross-origin headers above; now a FAIL rule |
| 10055 | `style-src` allows `'unsafe-inline'` | **Accepted.** React sets style attributes (a progress bar's width, an avatar's colours), which a nonce cannot cover. Scripts stay nonce-only, so an injected `<script>` or handler still does not run, which the smoke test proves. Inline styles alone can restyle a page or, with attribute selectors, leak an attribute's value; there is no user-controlled CSS anywhere in the app. Ignored in the rules, written here. |
| 10099 | "Source code disclosure: SQL" on `/whats-new` | **False positive**: the changelog's prose ("Revoke and a progress label on") matched the pattern. Ignored. |
| 10027 | "Suspicious comment" in `/icon.svg` | **Not a problem**: the icon carries a comment explaining its geometry. Ignored. |
| 10019 | No `Content-Type` on a 308 redirect | **Not a problem**: an empty redirect body has no type. Ignored. |
| 10049, 10109 | "Non-storable content", "Modern web application" | **Informational**: pages are deliberately not cached; it is a modern web application. Ignored. |

Rules marked FAIL in the configuration are the protections the app means
to have: a policy on every response, no framing, no sniffing, no framework
banner, HttpOnly and SameSite cookies, a permissions policy, the
cross-origin headers, scripts from this origin only, and no script library
with a known vulnerability. Every other rule warns: a new warning prints in
the CI log for a person to read, and is added to this table, fixed or
accepted, when it is.

## The usual attacks, tried

Fourteen attacks people try on a new web app, each tried against Robis in
`tests/attack-list.test.ts`, with deeper suites named where they exist.
Robis takes no payments, so the price and payment attacks are tried on what
stands in for them. This is a list of what has been tried, not a claim that
nothing else could work.

| Attack | What happens | Tried in |
| --- | --- | --- |
| Type `/admin` | There is no admin page or route; both answer 404 | `attack-list` |
| Change the id in the URL | Another workspace's issue, project, room, attachment or export is not found, through your workspace or theirs | `attack-list`, `authorization`, `attachments`, `chat` |
| An API key in the browser | The web app's only public settings are addresses; no served script holds a key, password or database address | `attack-list` |
| Edit the price | Fields a client should not set (who made it, which workspace, its number, demo, two-factor) are ignored | `attack-list` |
| Order -1 items | Negative, zero, enormous or non-numeric counts and lengths are refused | `attack-list` |
| Fake a payment | No payment route; the one inbound webhook (GitHub) is refused unless signed | `attack-list`, `github-links` |
| Redeem it 100 times | An invitation accepted ten times at once makes one membership; export and reset links, recovery codes and keyed writes work once | `attack-list`, `exports`, `two-factor`, `idempotency` |
| Admin at sign-up | Extra fields at sign-up are ignored; no role above your own can be given | `attack-list`, `authorization` |
| Guess the login code | Ten tries a minute per caller, and five wrong codes end the challenge | `attack-list`, `two-factor` |
| Prompt-inject the AI | The model only writes a one-sentence summary, marked as unchecked, that can mention nobody; it can act on nothing | `attack-list`, `triage` |
| A script in your username | Usernames take letters, digits, dot and underscore only; names are plain words, React escapes them, and every email is plain text | `attack-list` |
| Upload a non-photo | Only JPEG, PNG, WebP and AVIF, decoded and re-encoded; anything else is refused | `attack-list`, `attachments`, `avatars` |
| `.env` in Git | Only the example is tracked; real ones are ignored | `attack-list` |
| Query the database | Every query is parameterised; SQL typed into search is searched for as words; Postgres is not published outside the stack | `attack-list` |

## What is not checked

- **No active scan.** The ZAP baseline only reads responses; it sends no
  attacks. An active scan against the stack, signed in, is the next step.
- **Signed-out pages only.** The spider does not sign in, so the workspace
  pages are judged by the browser smoke test and the journeys, not ZAP.
- **Not a penetration test.** Nobody outside the project has tested Robis.
- **High and lower severities do not fail the build.** Trivy fails only on
  critical findings with a fix; others are left to Dependabot and reading.
- **HTTPS-only rules.** The ZAP run is over the development stack's plain
  HTTP, so `Secure` cookies and HSTS are checked instead by the
  production-mode smoke test (the `__Host-` session cookie over HTTPS) and
  the header tests (HSTS in production).
