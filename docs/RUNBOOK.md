# Runbook

What each alert in [`deploy/prometheus/alerts.yml`](../deploy/prometheus/alerts.yml)
means, and the first three things to check. Every rule is tested with
`promtool` in CI ([`alerts.test.yml`](../deploy/prometheus/alerts.test.yml)),
and `tests/alert-rules.test.ts` fails if a rule has no section here.

Robis has not been deployed, so none of this has been used in anger: it is
written from how the code behaves, and should be corrected by the first
real incident. **page** wants a person now; **ticket** wants one today.

Where to look, whatever the alert:

- **Metrics.** The API on `:9464`, the gateway on `:9465`, the MCP server
  on `:9466` and the worker on `:9467`, each at `/metrics`, inside the
  network only.
- **Logs.** One JSON object per line from every service. Search by
  `traceId` to see everything one request caused, or by `reqId` for the
  API's lines about one request.
- **Traces.** In whatever collector `OTEL_EXPORTER_OTLP_ENDPOINT` points
  at: a request, the jobs it queued and the mail they sent are one trace.

## RobisApiErrorRate

**page.** More than 5% of API requests are answering with a 5xx, at more
than six requests a minute.

1. Which routes: `sum by (route, status) (rate(robis_http_requests_total{status=~"5.."}[5m]))`.
   One route points at its handler; all of them point at something shared.
2. The API's error lines (`"level":"error"`, `msg` "unhandled error"): the
   `err` field names the failure, and its `traceId` shows the request.
3. The database: can the API connect, and is the pool waiting? A 503 with
   `images_busy` is image decoding at capacity, not a fault.

## RobisApiLatencyP99

**ticket.** The slowest 1% of API requests have taken over a second for ten
minutes.

1. Which routes: `histogram_quantile(0.99, sum by (le, route) (rate(robis_http_request_duration_seconds_bucket[5m])))`.
2. A slow trace for that route: the spans show whether the time went to the
   database, to the ML service (suggestions), or to image work.
3. The database: slow queries and locks (`pg_stat_activity`), and whether a
   migration or a large delete is running.

## RobisQueueBacklog

**ticket.** More than 100 jobs have been due and waiting for ten minutes.

1. Is the worker running and healthy (its container health check reads the
   heartbeat file), and how many are there?
2. What is waiting: `select kind, count(*) from jobs where status = 'pending' and run_at <= now() group by kind`.
   One kind piling up points at that handler or what it calls (mail, push,
   the MCP server).
3. `robis_jobs_total` by kind and outcome: a kind that is `retrying` over and
   over is failing, not slow.

## RobisOldestJobWaiting

**page.** A job has waited more than five minutes for a worker. Mail,
notifications, pushes and purges all ride the queue, so people notice.

1. Is any worker running? The same checks as RobisQueueBacklog.
2. `RobisWorkerCannotReadQueue` alongside it means the database, not the
   worker.
3. A worker that claims jobs and never finishes them: jobs locked for longer
   than a minute are taken back by another worker, so a long `locked_at`
   with repeated attempts points at a handler that hangs.

## RobisDeadLetters

**ticket.** A job has used up its attempts. Whatever it was for (an email,
a push, a file purge) will not happen unless a person looks.

1. Which: `select kind, last_error, attempts, created_at from jobs where status = 'failed' order by created_at desc limit 20`.
2. Its trace, from the request that queued it, through every attempt.
3. Fix the cause, then retry by setting the job back to `pending` with
   `attempts = 0`. A dead purge leaves a file in storage, so retry it rather
   than delete the row.

## RobisWorkerCannotReadQueue

**page.** For five minutes the worker's metrics could not read the `jobs`
table.

1. The database: is it up, and can the worker's role (`robis_worker`)
   connect? Its log lines say "the queue could not be read" with the error.
2. Grants: a migration that added a table or column the worker reads needs
   `bun run db:roles` (see [DEPLOY.md](DEPLOY.md)).
3. Connection limits: the worker holds a small pool and a LISTEN connection.

## RobisAuditStreamLag

**ticket.** Over 1,000 audit events have not been acknowledged by the
stream receiver for fifteen minutes. Nothing is lost: the stream resumes
from each workspace's cursor.

1. The worker's log lines from the `audit.stream` job: a receiver refusing
   one workspace does not hold up the others, and each failure names it.
2. Can the worker reach the receiver's URL, and is its token still valid?
3. `audit.stream` in the dead letters: if its job died, its schedule died
   with it until the worker restarts.

## RobisGatewaySocketsDropped

**page.** People are using the API but no one has held a live connection
for ten minutes: changes still save, but nobody sees them arrive.

1. Is the gateway running and healthy (`/health` on its port), and does the
   edge proxy still route `/ws` to it?
2. Its upgrades: `robis_ws_upgrades_total` by outcome. Refusals by origin
   point at `WEB_ORIGIN`; by session, at the cookie name or the sessions
   table.
3. Its database: the gateway LISTENs for events on one connection and
   reads sessions on another; its log lines say which failed.

## RobisMlDown

**ticket.** Most calls to the ML service have failed for ten minutes, so
the composer shows no duplicate or priority hints. Nothing else depends on
it.

1. `robis_ml_requests_total` by outcome: `unreachable` means no answer in
   time (the service, the network, `ML_TIMEOUT_MS`); `error` means it
   answered with a failure.
2. The ML service's JSON log lines and its `/health`.
3. Its token: `ML_SERVICE_TOKEN` on the API must match the service's, or
   every call is refused.
