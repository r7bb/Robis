import { sessionCookieName } from '@robis/auth';
import { createDatabase } from '@robis/database';
import { loadConfig, portFrom } from '@robis/shared/config';
import postgres from 'postgres';
import { createGateway } from './gateway.ts';

// Before anything else, and failing closed: see `loadConfig`. The origin
// is the one the gateway checks every connection's Origin against.
const {
  nodeEnv: NODE_ENV,
  databaseUrl: DATABASE_URL,
  webOrigin: WEB_ORIGIN,
  metricsHost,
} = loadConfig(process.env, { webOrigin: true });

const PORT = portFrom(process.env, 'REALTIME_PORT', 4001);

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
    port: portFrom(process.env, 'REALTIME_METRICS_PORT', 9465),
    hostname: metricsHost,
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
