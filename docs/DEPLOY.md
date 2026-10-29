# Deploying Robis

What a deployment looks like, and what it needs. How to run it locally is in
[GETTING_STARTED.md](GETTING_STARTED.md). Robis has not been deployed; this is
the shape the container stack in [deploy/compose.yaml](../deploy/compose.yaml)
already runs and CI drives on every push.

## One origin

Everything is served from one address, through an edge proxy
([deploy/Caddyfile](../deploy/Caddyfile)):

```text
                    https://robis.example
                            |
                      edge proxy (Caddy)
          +-----------------+------------------+
          |                 |                  |
          /               /api/*              /ws
          |                 |                  |
       web app      API (prefix removed)   realtime gateway
       :3000             :4000                :4001
                            |                  |
                            +------ Postgres ---+------ worker
                            |                          |
                       object storage              mail (SMTP)
                            |
                       ML service :8000 (API only)
```

- **The web image holds no addresses.** It calls the API at `/api` and opens
  the gateway at `/ws` on whatever origin served it
  ([frontend/lib/endpoints.ts](../frontend/lib/endpoints.ts)), so one built
  image runs at any address. A production build that bakes in a localhost
  address is refused at build time.
- **No CORS.** The API answers only its own origin; no response tells
  another site it may read it.
- **Only the proxy is published.** The API, gateway, worker, ML service,
  database and storage are reachable only on the private network.
- **The proxy is the one trusted hop.** Set `TRUST_PROXY=1` on the API (the
  stack does), so rate limits key on the client's address from
  `X-Forwarded-For`, not the proxy's.
- **Two supported layouts for client addresses.** Either Caddy faces
  clients directly (it replaces any `X-Forwarded-For` it receives, and
  `TRUST_PROXY=1` trusts exactly that one hop), or a load balancer sits in
  front: then list the load balancer's own address range in Caddy's
  `trusted_proxies` and set `TRUST_PROXY=2`. Never trust `0.0.0.0/0`: any
  client could then name its own address and slip its rate limits.
- **TLS** terminates at the proxy or in front of it. The stack's Caddyfile
  serves plain HTTP on `:8080` with `auto_https off`, for 127.0.0.1 only; a
  deployment replaces `:8080` with its hostname and removes `auto_https off`
  (or terminates TLS at the load balancer). Only over HTTPS does the web app
  send HSTS for its host, session cookies become `__Host-` and Secure, and
  the gateway is reached over `wss:`.
- **Open it at exactly `WEB_ORIGIN`.** Writes and sockets are accepted only
  from that origin, compared exactly, so the same stack opened at
  `127.0.0.1` instead of `localhost` refuses them. A deployment should
  redirect any other hostname to the canonical one at the proxy.
- **`WEB_ORIGIN`** is that one https origin, on the API, gateway and worker:
  writes and sockets from any other origin are refused, and every mailed
  link is built from it. Production refuses to start without it, or with
  plain http.

Metrics are on internal ports (API 9464, gateway 9465) for a scraper on the
private network, never through the proxy.

## Tested as production runs it

[deploy/compose.production.yaml](../deploy/compose.production.yaml) layers
production onto the stack: `NODE_ENV=production` everywhere, the proxy
serving HTTPS ([deploy/Caddyfile.production](../deploy/Caddyfile.production))
with a throwaway certificate from `scripts/smoke/throwaway-tls.ts`, mail
over STARTTLS to the sink (which the worker trusts through
`NODE_EXTRA_CA_CERTS`), a fresh audit key and no demo data. CI brings it up
after the development stack and runs the same smoke tests over HTTPS. To
run it locally:

```bash
bun run scripts/smoke/throwaway-tls.ts
CI_AUDIT_HMAC_KEYS="ci:$(openssl rand -base64 32)" \
  docker compose -f deploy/compose.yaml -f deploy/compose.production.yaml up -d --wait
NODE_EXTRA_CA_CERTS=deploy/.tls/ca.pem SMOKE_WEB_URL=https://127.0.0.1:8443 \
  SMOKE_WEB_ORIGIN=https://localhost:8443 bun run smoke:stack
```

## Database connections

Each service keeps its own pool; together they must fit under Postgres's
`max_connections` (100 by default), with room for the migrator, an
operator's session and a deploy that briefly runs old and new side by side.

| Service | Connections each | Notes |
| --- | --- | --- |
| API | `DB_POOL_MAX` (default 10) | every request resolves a session, then its own queries |
| Gateway | 5 + 1 | the extra one is held open for `LISTEN`; as `robis_gateway` |
| Worker | 5 | jobs, mail and the audit stream share it; as `robis_worker` |
| ML service | 1 per request in flight | opened and closed per request; as `robis_ml`, which reads only the `ml_issues` view |
| Migrator, roles CLI | 1 | one-shot, before the services start |

One of each at the defaults is **22**. A budget for N replicas of the API,
M of the gateway and W of the worker:

```text
10N + 6M + 5W + (ML requests in flight) + 1 (migrator) + 5 (operators and slack) <= max_connections
```

So 3 API, 2 gateway and 1 worker replicas need about 60, and doubling the
API to 6 needs about 90, which is where a connection pooler (PgBouncer in
transaction mode) or a larger `max_connections` should come first. The
gateway's `LISTEN` connection cannot go through a transaction-mode pooler:
point it at Postgres directly.

## What else a deployment needs

- The database owner for migrations and roles (`MIGRATION_DATABASE_URL`),
  the runtime role for the services (`DATABASE_URL`, `APP_DB_PASSWORD`), and
  a role per service: `ML_DB_PASSWORD`, `GATEWAY_DB_PASSWORD` and
  `WORKER_DB_PASSWORD` when running `db:roles` make `robis_ml`,
  `robis_gateway` and `robis_worker`, each granted only what its code needs
  (`GATEWAY_GRANTS` and `WORKER_GRANTS` in `backend/database/src/roles.ts`),
  and each service's `DATABASE_URL` names its own.
- `AUDIT_HMAC_KEYS` on the API and worker, kept outside the database.
- A mail driver (`SMTP_*`, `MAIL_FROM`): the API and worker refuse to start
  in production without one.
- Object storage (`STORAGE_DRIVER=s3` and its `S3_*` settings), or local
  disk at an absolute `MEDIA_DIR`.
- `NODE_ENV=production` on every service; nothing guesses it.

The full list, and what each refuses without, is in
[GETTING_STARTED.md](GETTING_STARTED.md) and
[ARCHITECTURE.md](ARCHITECTURE.md).
