import { sessionCookieName } from '@robis/auth';
import { createDatabase } from '@robis/database';
import { requireNodeEnv, webOriginOf } from '@robis/shared';
import postgres from 'postgres';
import { createGateway } from './gateway.ts';

// Before anything else: see `requireNodeEnv`.
const NODE_ENV = requireNodeEnv(process.env.NODE_ENV);

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required');

const PORT = portFrom('REALTIME_PORT', 4001);
const WEB_ORIGIN = webOriginOf(process.env.WEB_ORIGIN ?? 'http://localhost:3000');

/** A port from the environment, checked now rather than failing later. */
function portFrom(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a port number; got "${raw}".`);
  }
  return value;
}

const { db, close } = createDatabase(DATABASE_URL, { max: 5 });

// LISTEN occupies a connection for as long as it is subscribed, so it gets its
// own single-connection client instead of starving the query pool.
const listenClient = postgres(DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

const gateway = await createGateway({
  db,
  listenClient,
  port: PORT,
  webOrigin: WEB_ORIGIN,
  sessionCookie: sessionCookieName(NODE_ENV),
  metrics: {
    port: portFrom('REALTIME_METRICS_PORT', 9465),
    hostname: process.env.METRICS_HOST ?? '127.0.0.1',
  },
});

console.log(
  `Realtime gateway listening on ws://localhost:${gateway.port}/ws (instance ${gateway.instanceId.slice(0, 8)})`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await gateway.close();
    await listenClient.end({ timeout: 5 });
    await close();
    process.exit(0);
  });
}
