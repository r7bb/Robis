# Running Robis

How to run it, the commands, and what a deployment needs. Back to the
[README](../README.md); how it works is in [HOW_IT_WORKS.md](HOW_IT_WORKS.md).

## The quickest way: the container stack

```bash
docker compose -f deploy/compose.yaml up --build --wait
bun run smoke:stack
bun run smoke:browser
```

Everything is reached through one address, the edge proxy on port 3000:
the web app at `/`, the API at `/api` and the gateway at `/ws`. Open it at
<http://localhost:3000> exactly: writes and the live socket are accepted
only from that origin, so `127.0.0.1:3000` would refuse them. The layout,
and what a real deployment adds, is in [DEPLOY.md](DEPLOY.md).

The images are in [deploy/docker](../deploy/docker). The stack serves plain
http on 127.0.0.1, so its services run in development mode. Set
`STACK_WEB_PORT` if port 3000 is taken.

The stack seeds the demo accounts on its first start, so there is nothing
to create: open <http://localhost:3000> and sign in as `rohit@robis.test`
with `robis-demo-password`, owner of the Engineering, Design and Launch
workspaces (Alex, John and Mia sign in the same way, in a mix of roles).
Later starts leave the accounts and anything changed in them alone, and
add any demo workspace that is missing.

## For development: each service on its own

```bash
bun install
bun run db:start && bun run db:migrate && bun run db:seed -- --team

bun run dev:api        # :4000
bun run dev:realtime   # :4001
bun run dev:worker
bun run dev:web        # :3000
```

Sign in as `rohit@robis.test` with `robis-demo-password`.

## Commands

| Command                  | What it does                                        |
| ------------------------ | --------------------------------------------------- |
| `bun test`               | the suite; counts in the roadmap                    |
| `bun run typecheck`      | every package                                       |
| `bun run lint`           | Biome                                               |
| `bun run loadtest`       | the benchmark in [HOW_IT_WORKS.md](HOW_IT_WORKS.md) |
| `bun run screenshots`    | recapture every still image in the README           |
| `bun run capture:motion` | recapture the README's moving pictures              |
| `bun run db:reset`       | drop and recreate the dev database                  |
| `bun run db:roles`       | create the app's runtime database role              |
| `bun run audit:seal`     | sign audit trails from before signing, once         |
| `bun run audit:erase`    | erase a person's fields from the trail (draft)      |
| `bun run mail:start`     | local mail inbox, SMTP on port 1025                 |
| `bun run smoke:stack`    | drive a running container stack                     |
| `bun run smoke:browser`  | load the stack in Chrome under its security policy  |

Every picture in the README comes from those two capture scripts driving a
real Chrome against the running app. None of them is a mockup.
`bun run screenshots` needs the development servers above (with
`NEXT_PUBLIC_ENABLE_SW=1` on the web app and `AUTH_FORGOT_PER_HOUR=100` on
the API); `bun run capture:motion` needs the container stack.

## What a deployment needs

A deployment runs migrations and `db:roles` as the database owner
(`MIGRATION_DATABASE_URL`), and the services as the runtime role
(`DATABASE_URL`, user `robis_app`, password `APP_DB_PASSWORD`), which can add
audit events but not change them. Locally the owner works for everything;
to run as the role, set
`DATABASE_URL=postgres://robis_app:robis_app_development@localhost:5433/robis`
after `bun run db:roles`. The tests always run as the role. Outside
development the audit trail needs a signing key in `AUDIT_HMAC_KEYS`
(`<id>:<base64 of 32+ random bytes>`). Upgrading a database whose trail
predates signing: deploy, then run `bun run audit:seal` once, with the same
key, to sign every old chain.

Every service refuses to start without `NODE_ENV`, and in production
without its database and web addresses (see "Configuration fails closed" in
[ARCHITECTURE.md](ARCHITECTURE.md)).

To send real mail, give the worker `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS` and `MAIL_FROM` (`SMTP_SECURE=true` for port 465). Locally,
`SMTP_HOST=127.0.0.1 SMTP_PORT=1025` sends to `bun run mail:start`, whose
inbox is at <http://127.0.0.1:8025>. With no `SMTP_HOST`, mail is printed to
the worker's log.

## Behind a proxy, and streaming the audit trail

**Behind a proxy, set `TRUST_PROXY`.** It defaults to trusting no proxy,
which is right when the API faces clients directly. Behind a load balancer
left unset, every client appears to come from the proxy's address and
shares one rate-limit bucket. Set the number of trusted hops (`1` for one
proxy) or the proxy's addresses, and keep the API port unreachable except
through that proxy.

**Streaming the audit trail to a SIEM.** Set `AUDIT_STREAM_URL` (https, or
http to localhost only) and optionally `AUDIT_STREAM_TOKEN` for the worker.
It POSTs `{ "source": "robis", "events": [...] }` in batches of up to 100
and moves on only after a 2xx. Delivery is at-least-once: after a lost
response the batch is sent again, so deduplicate on each event's `key`.
