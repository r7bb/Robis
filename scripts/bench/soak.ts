/**
 * Soak test for the realtime gateway (E2): `bun run soak`.
 *
 *   bun run soak -- --sockets 1000 --minutes 30
 *
 * Opens one socket per account, all subscribed to one workspace and
 * pinging as the web app does, and holds them for the run, reading the
 * gateway's memory (RSS), its open file descriptors and its presence
 * entries once a minute. Then half the sockets are dropped without a
 * goodbye (as a laptop lid closes) and the rest closed politely, and the
 * presence entries are read again: anything left after the presence
 * lifetime is a ghost. Runs the gateway as its own process, on its own
 * port, against DATABASE_URL.
 */

import { createDatabase } from '@robis/database';
import { type Fixture, setupFixture, teardownFixture, waitForHealth } from './fixture.ts';

const flag = (name: string, fallback: number) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return raw === undefined ? fallback : Number(raw);
};
const SOCKETS = flag('sockets', 1000);
const MINUTES = flag('minutes', 30);
const PORT = flag('ws-port', 4111);
const PING_MS = 20_000;
/** The gateway's presence lifetime (45 s), and a margin. */
const GHOST_WAIT_MS = 60_000;
const SAMPLE_MS = 60_000;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://robis:robis@localhost:5433/robis';

const { db, close } = createDatabase(DATABASE_URL, { max: 10 });
const gateway = Bun.spawn(['bun', 'backend/realtime/src/main.ts'], {
  env: {
    ...process.env,
    DATABASE_URL,
    REALTIME_PORT: String(PORT),
    WEB_ORIGIN: 'http://localhost:3000',
  },
  stdout: 'ignore',
  stderr: 'inherit',
});

const health = async () =>
  (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as {
    connections: number;
    presence: number;
  };

/** The gateway's resident memory in MB and its open descriptors. */
function processUse(pid: number) {
  const rss =
    Number(
      Bun.spawnSync(['ps', '-o', 'rss=', '-p', String(pid)])
        .stdout.toString()
        .trim(),
    ) / 1024;
  const fds =
    Bun.spawnSync(['lsof', '-p', String(pid)])
      .stdout.toString()
      .trim()
      .split('\n').length - 1;
  return { rssMb: Math.round(rss), fds };
}

function open(cookie: string, workspaceId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { cookie, origin: 'http://localhost:3000' },
    } as unknown as string[]);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe', workspaceId }));
      resolve(socket);
    });
    socket.addEventListener('error', () => reject(new Error('socket failed to open')));
  });
}

let fixture: Fixture | null = null;
const samples: {
  minute: number;
  connections: number;
  presence: number;
  rssMb: number;
  fds: number;
}[] = [];
try {
  await waitForHealth(`http://127.0.0.1:${PORT}/health`, 'Gateway');
  fixture = await setupFixture(db, SOCKETS, 1);
  const sockets: WebSocket[] = [];
  for (const actor of fixture.actors) sockets.push(await open(actor.cookie, fixture.workspaceId));
  const pinger = setInterval(() => {
    for (const socket of sockets)
      if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
  }, PING_MS);
  console.log(`Soak: ${sockets.length} sockets for ${MINUTES} minute(s)`);
  for (let minute = 0; minute <= MINUTES; minute++) {
    const { connections, presence } = await health();
    const use = processUse(gateway.pid);
    samples.push({ minute, connections, presence, ...use });
    console.log(
      `  minute ${minute}: ${connections} sockets, ${presence} present, ${use.rssMb} MB, ${use.fds} fds`,
    );
    if (minute < MINUTES) await Bun.sleep(SAMPLE_MS);
  }
  clearInterval(pinger);
  // Half drop without a word, half say goodbye.
  for (const [i, socket] of sockets.entries()) {
    if (i % 2 === 0) socket.terminate?.();
    else socket.close(1000);
  }
  await Bun.sleep(GHOST_WAIT_MS);
  const after = await health();
  const first = samples[1] ?? samples[0]!;
  const last = samples.at(-1)!;
  console.log(
    JSON.stringify({
      sockets: SOCKETS,
      minutes: MINUTES,
      rssMb: { first: first.rssMb, last: last.rssMb },
      fds: { first: first.fds, last: last.fds },
      presenceAfterClose: after.presence,
      connectionsAfterClose: after.connections,
    }),
  );
  if (after.presence > 0 || after.connections > 0) {
    console.error(
      `Ghosts: ${after.presence} presence entries and ${after.connections} sockets left.`,
    );
    process.exitCode = 1;
  }
} finally {
  if (fixture) await teardownFixture(db, fixture).catch(() => {});
  gateway.kill();
  await gateway.exited;
  await close();
}
