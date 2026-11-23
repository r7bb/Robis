import { createDatabase } from '@robis/database';
import { formatMs, type ServerMessage, type Summary, summarize } from '@robis/shared';
import { COALESCE_MS, coalescer } from '@robis/web/lib/realtime-events.ts';
import { sql } from 'drizzle-orm';
import {
  type Actor,
  type Fixture,
  portIsFree,
  setupFixture,
  teardownFixture,
  waitForHealth,
} from './fixture.ts';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://robis:robis@localhost:5433/robis';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

function option(name: string, fallback: number): number {
  const flagIndex = process.argv.indexOf(`--${name}`);
  const raw =
    flagIndex !== -1
      ? process.argv[flagIndex + 1]
      : process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} expects a number, got "${raw}"`);
  return value;
}

const options = {
  /** Concurrent API callers. Closed-loop, so this is the concurrency, not a rate. */
  connections: option('connections', 32),
  /** Seconds of measured traffic per phase. */
  duration: option('duration', 10),
  /** Seconds of traffic discarded before measuring. */
  warmup: option('warmup', 3),
  /** Share of API operations that are writes. */
  writePercent: option('write-percent', 20),
  /**
   * Issue creation takes a row lock on the project to reserve the next issue
   * number, so writers in one project serialize. Spreading them shows the
   * uncontended path; `--projects 1` shows the contended one.
   */
  projects: option('projects', 4),
  /** WebSocket clients watching the workspace during the fan-out phase. */
  subscribers: option('subscribers', 50),
  /** Events per second offered during the fan-out phase. */
  rate: option('rate', 20),
  apiPort: option('api-port', 4100),
  wsPort: option('ws-port', 4101),
};

/** Dedicated ports, so a running dev stack is neither disturbed nor measured. */
const API_URL = `http://127.0.0.1:${options.apiPort}`;
const WS_URL = `ws://127.0.0.1:${options.wsPort}/ws`;

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event-loop lag
// ---------------------------------------------------------------------------

/**
 * How late this process is running its own timers.
 *
 * The subscribers are in this process, so if the harness is saturated its
 * delay shows up as gateway latency. Reporting the lag is what makes the
 * delivery numbers interpretable rather than merely precise.
 */
function startLagMonitor(intervalMs = 20) {
  const samples: number[] = [];
  let previous = performance.now();

  const timer = setInterval(() => {
    const now = performance.now();
    samples.push(Math.max(0, now - previous - intervalMs));
    previous = now;
  }, intervalMs);

  return { samples, stop: () => clearInterval(timer) };
}

// ---------------------------------------------------------------------------
// Phase 1 - REST API under concurrency
// ---------------------------------------------------------------------------

type ApiResult = {
  read: number[];
  write: number[];
  errors: number;
  elapsedSeconds: number;
  /** Harness scheduling delay, to tell a saturated server from a saturated client. */
  lag: number[];
};

async function phaseApi(fixture: Fixture): Promise<ApiResult> {
  const read: number[] = [];
  const write: number[] = [];
  let errors = 0;
  let operation = 0;

  async function once(actor: Actor, projectId: string, collect: boolean) {
    // Deterministic interleaving rather than random, so two runs offer the
    // same mix and are comparable.
    const isWrite = operation++ % 100 < options.writePercent;
    const started = performance.now();

    let ok = false;
    if (isWrite) {
      const response = await fetch(
        `${API_URL}/workspaces/${fixture.workspaceId}/projects/${projectId}/issues`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: actor.cookie },
          body: JSON.stringify({ id: crypto.randomUUID(), title: `Load issue ${operation}` }),
        },
      );
      ok = response.ok;
      await response.text();
    } else {
      const response = await fetch(
        `${API_URL}/workspaces/${fixture.workspaceId}/projects/${projectId}/issues?limit=25`,
        { headers: { cookie: actor.cookie } },
      );
      ok = response.ok;
      await response.text();
    }

    const elapsed = performance.now() - started;

    if (!ok) {
      if (collect) errors++;
      return;
    }
    if (collect) (isWrite ? write : read).push(elapsed);
  }

  /** One closed-loop caller: never more than one request in flight. */
  async function worker(index: number, until: number, collect: boolean) {
    const actor = fixture.actors[index % fixture.actors.length]!;
    const projectId = fixture.projectIds[index % fixture.projectIds.length]!;

    while (performance.now() < until) {
      await once(actor, projectId, collect);
    }
  }

  const spawn = (until: number, collect: boolean) =>
    Promise.all(Array.from({ length: options.connections }, (_, i) => worker(i, until, collect)));

  await spawn(performance.now() + options.warmup * 1000, false);

  const lag = startLagMonitor();
  const startedAt = performance.now();
  await spawn(startedAt + options.duration * 1000, true);
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  lag.stop();

  return { read, write, errors, elapsedSeconds, lag: lag.samples };
}

// ---------------------------------------------------------------------------
// Phase 2 - Realtime fan-out
// ---------------------------------------------------------------------------

type FanoutResult = {
  ack: number[];
  first: number[];
  last: number[];
  published: number;
  expectedReceipts: number;
  actualReceipts: number;
  skipped: number;
  failed: number;
  subscribers: number;
  lag: number[];
  /** The follow-up reads the subscribers made, as an open board would. */
  reads: number[];
  readsFailed: number;
};

/**
 * Open one authenticated socket, scoped to `projectId` as an open board is,
 * and resolve once it is subscribed.
 */
function connectSubscriber(
  actor: Actor,
  workspaceId: string,
  projectId: string,
  onEvent: (issueId: string) => void,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL, { headers: { cookie: actor.cookie } });
    const timer = setTimeout(() => reject(new Error('subscribe timed out')), 15_000);

    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('socket error'));
    });

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', workspaceId }));
    });

    socket.addEventListener('message', (message) => {
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(String(message.data)) as ServerMessage;
      } catch {
        return;
      }

      if (parsed.type === 'ready') {
        clearTimeout(timer);
        socket.send(JSON.stringify({ type: 'scopes', scopes: [{ kind: 'project', projectId }] }));
        resolve(socket);
        return;
      }

      if (parsed.type === 'event' && parsed.event.type === 'issue.created') {
        onEvent(parsed.event.issueId);
      }
    });
  });
}

async function phaseFanout(fixture: Fixture): Promise<FanoutResult> {
  const subscriberCount = Math.min(options.subscribers, fixture.actors.length);

  /** Issue id -> when it was offered, and when each subscriber saw it. */
  const inFlight = new Map<string, { startedAt: number; receipts: number[] }>();
  const projectId = fixture.projectIds[0]!;

  /*
   * What each event then costs: every subscriber re-reads the issue list as
   * an open board does, with the web app's own coalescing, so a burst of
   * writes is one read per subscriber rather than one per write.
   */
  const reads: number[] = [];
  let readsFailed = 0;
  const pulls = Array.from({ length: subscriberCount }, (_, i) =>
    coalescer<true>(async () => {
      const startedAt = performance.now();
      try {
        const response = await fetch(
          `${API_URL}/workspaces/${fixture.workspaceId}/projects/${projectId}/issues?limit=100`,
          { headers: { cookie: fixture.actors[i]!.cookie } },
        );
        await response.text();
        if (response.ok) reads.push(performance.now() - startedAt);
        else readsFailed++;
      } catch {
        readsFailed++;
      }
    }, COALESCE_MS),
  );

  const sockets = await Promise.all(
    Array.from({ length: subscriberCount }, (_, i) =>
      connectSubscriber(fixture.actors[i]!, fixture.workspaceId, projectId, (issueId) => {
        const record = inFlight.get(issueId);
        if (record) record.receipts.push(performance.now() - record.startedAt);
        pulls[i]!.push(true);
      }),
    ),
  );

  // Presence gossip from every socket joining at once is still settling;
  // measuring through it would attribute connect cost to fan-out.
  await Bun.sleep(500);

  const writer = fixture.actors[0]!;

  const ack: number[] = [];
  let published = 0;
  let skipped = 0;
  let failed = 0;

  /**
   * Cap concurrent writes. Open-loop means offering events on schedule
   * regardless of completion, but unbounded pile-up would end as a memory
   * problem rather than a measurement; skipped offers are counted and
   * reported instead of quietly lowering the offered rate.
   */
  const maxInFlight = Math.max(8, options.rate);
  let outstanding = 0;

  async function offer() {
    if (outstanding >= maxInFlight) {
      skipped++;
      return;
    }

    const issueId = crypto.randomUUID();
    const startedAt = performance.now();
    inFlight.set(issueId, { startedAt, receipts: [] });
    outstanding++;
    published++;

    try {
      const response = await fetch(
        `${API_URL}/workspaces/${fixture.workspaceId}/projects/${projectId}/issues`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: writer.cookie },
          body: JSON.stringify({ id: issueId, title: 'Fan-out probe' }),
        },
      );
      await response.text();

      if (response.ok) ack.push(performance.now() - startedAt);
      else failed++;
    } catch {
      failed++;
    } finally {
      outstanding--;
    }
  }

  const lag = startLagMonitor();

  const interval = setInterval(() => void offer(), Math.max(1, 1000 / options.rate));
  await Bun.sleep(options.duration * 1000);
  clearInterval(interval);

  // Let the tail arrive before counting anything as lost.
  await Bun.sleep(2000);
  lag.stop();

  for (const socket of sockets) socket.close();

  const first: number[] = [];
  const last: number[] = [];
  let actualReceipts = 0;

  for (const record of inFlight.values()) {
    actualReceipts += record.receipts.length;
    if (record.receipts.length === 0) continue;

    first.push(Math.min(...record.receipts));
    // Only a complete set means "everyone has it"; a partial max would
    // flatter the number by ignoring whoever had not received it yet.
    if (record.receipts.length === subscriberCount) last.push(Math.max(...record.receipts));
  }

  return {
    ack,
    first,
    last,
    published,
    expectedReceipts: published * subscriberCount,
    actualReceipts,
    skipped,
    failed,
    subscribers: subscriberCount,
    lag: lag.samples,
    reads,
    readsFailed,
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const COLUMNS = ['count', 'min', 'p50', 'p95', 'p99', 'max'] as const;

function header(label: string, width: number) {
  console.log(`  ${label.padEnd(width)}${COLUMNS.map((c) => c.padStart(9)).join('')}`);
}

function row(label: string, width: number, summary: Summary | null) {
  if (!summary) {
    console.log(`  ${label.padEnd(width)}${'no samples'.padStart(9)}`);
    return;
  }

  const cells = [
    String(summary.count),
    formatMs(summary.min),
    formatMs(summary.p50),
    formatMs(summary.p95),
    formatMs(summary.p99),
    formatMs(summary.max),
  ];

  console.log(`  ${label.padEnd(width)}${cells.map((c) => c.padStart(9)).join('')}`);
}

function reportApi(result: ApiResult) {
  const total = result.read.length + result.write.length;

  console.log(`\nPhase 1 · REST API under concurrency`);
  console.log(
    `  ${options.connections} connections · ${options.projects} project(s) · ` +
      `${options.writePercent}% writes · ${options.duration}s measured, ${options.warmup}s warmup discarded`,
  );
  console.log('');

  header('operation (ms)', 18);
  row('read  (list issues)', 18, summarize(result.read));
  row('write (create issue)', 18, summarize(result.write));

  console.log('');
  console.log(
    `  throughput  ${(total / result.elapsedSeconds).toFixed(0)} req/s over ` +
      `${result.elapsedSeconds.toFixed(1)}s · ${result.errors} error(s)`,
  );

  const lag = summarize(result.lag);
  if (lag) {
    console.log(
      `  harness event-loop lag  p50 ${formatMs(lag.p50)}ms · p99 ${formatMs(lag.p99)}ms ` +
        `(if this is large the client is the bottleneck, not the server)`,
    );
  }
}

function reportFanout(result: FanoutResult) {
  const completeness =
    result.expectedReceipts === 0 ? 0 : (result.actualReceipts / result.expectedReceipts) * 100;

  console.log(`\nPhase 2 · Realtime fan-out (write → every other client)`);
  console.log(
    `  ${result.subscribers} subscribed sockets · ${options.rate} events/s offered · ${options.duration}s`,
  );
  console.log('');

  header('stage (ms)', 18);
  row('write ack (HTTP)', 18, summarize(result.ack));
  row('first subscriber', 18, summarize(result.first));
  row('all subscribers', 18, summarize(result.last));
  row('follow-up read', 18, summarize(result.reads));

  console.log('');
  console.log(
    `  delivered   ${result.actualReceipts}/${result.expectedReceipts} ` +
      `(${completeness.toFixed(2)}%) across ${result.published} events`,
  );
  const perWrite = result.published === 0 ? 0 : result.reads.length / result.published;
  console.log(
    `  reads       ${result.reads.length} follow-up reads for ${result.published} writes ` +
      `(${perWrite.toFixed(2)} per write across ${result.subscribers} boards, ` +
      `coalesced within ${COALESCE_MS} ms)`,
  );
  if (result.readsFailed > 0) console.log(`  read fails  ${result.readsFailed}`);
  if (result.skipped > 0)
    console.log(`  skipped     ${result.skipped} offers (writer at capacity)`);
  if (result.failed > 0) console.log(`  failed      ${result.failed} writes`);

  const lag = summarize(result.lag);
  if (lag) {
    console.log(
      `  harness event-loop lag  p50 ${formatMs(lag.p50)}ms · p99 ${formatMs(lag.p99)}ms ` +
        `(subscribers share this process, so this is inside the delivery numbers)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

for (const port of [options.apiPort, options.wsPort]) {
  if (!portIsFree(port)) {
    console.error(`Port ${port} is in use. Pass --api-port / --ws-port to move the harness.`);
    process.exit(1);
  }
}

const { db, close } = createDatabase(DATABASE_URL, { max: 20 });

try {
  await db.execute(sql`select 1`);
} catch {
  console.error(`Cannot reach Postgres at ${DATABASE_URL}. Run "bun run db:start" first.`);
  await close();
  process.exit(1);
}

const childEnv = {
  ...process.env,
  // The servers refuse to start without one; a harness run is development.
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL,
  API_PORT: String(options.apiPort),
  REALTIME_PORT: String(options.wsPort),
  // The gateway rejects a mismatched Origin; the harness sends none at all,
  // which is allowed, but this keeps the setting explicit.
  WEB_ORIGIN: 'http://localhost:3000',
  API_LOG: '0',
};

const api = Bun.spawn(['bun', 'backend/api/src/main.ts'], {
  env: childEnv,
  stdout: 'ignore',
  stderr: 'inherit',
});

const gateway = Bun.spawn(['bun', 'backend/realtime/src/main.ts'], {
  env: childEnv,
  stdout: 'ignore',
  stderr: 'inherit',
});

let fixture: Fixture | null = null;

async function shutdown() {
  if (fixture) await teardownFixture(db, fixture).catch(() => {});
  api.kill();
  gateway.kill();
  await Promise.all([api.exited, gateway.exited]);
  await close();
}

process.once('SIGINT', async () => {
  await shutdown();
  process.exit(130);
});

try {
  await waitForHealth(`${API_URL}/health`, 'API');
  await waitForHealth(`http://127.0.0.1:${options.wsPort}/health`, 'Gateway');

  // Enough accounts for every subscriber to be a distinct session, which is
  // what the gateway would see in production.
  const accounts = Math.max(options.connections, options.subscribers, 1);
  fixture = await setupFixture(db, accounts, options.projects);

  console.log('Robis load test');
  console.log(`  api         ${API_URL} (request logging off)`);
  console.log(`  gateway     ${WS_URL}`);
  console.log(`  database    ${DATABASE_URL.replace(/\/\/[^@]*@/, '//')}`);
  console.log(
    `  machine     ${process.platform} ${process.arch} · ${navigator.hardwareConcurrency} cores · Bun ${Bun.version}`,
  );

  const apiResult = await phaseApi(fixture);
  reportApi(apiResult);
  const fanoutResult = await phaseFanout(fixture);
  reportFanout(fanoutResult);
  // For the CI baseline (E2): the figures a regression would show in.
  const jsonPath = process.argv.find((a) => a.startsWith('--json='))?.split('=')[1];
  if (jsonPath) {
    const p99 = (samples: number[]) => summarize(samples)?.p99 ?? null;
    await Bun.write(
      jsonPath,
      JSON.stringify({
        read: p99(apiResult.read),
        write: p99(apiResult.write),
        fanout: p99(fanoutResult.last),
        errors: apiResult.errors + fanoutResult.failed,
      }),
    );
  }

  console.log('\nSingle machine, loopback networking, local Postgres. Useful for comparing');
  console.log('changes to this codebase against each other; not a capacity plan.\n');
} finally {
  await shutdown();
}
