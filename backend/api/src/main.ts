import {
  auditKeyringFromEnv,
  configureAuditKeys,
  createDatabase,
  settleDeferredAccountEvents,
} from '@robis/database';
import { mailerFromEnv } from '@robis/mailer';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const { db, close } = createDatabase(env.DATABASE_URL, { max: env.DB_POOL_MAX });

/*
 * Mail is sent by the worker, but the API checks the same configuration and
 * refuses to start without a production driver. Accepting reset requests
 * that nothing will ever deliver, or that the console driver would print
 * into a log, is worse than not starting: the missing piece stays visible.
 */
mailerFromEnv({ ...process.env, NODE_ENV: env.NODE_ENV });

// The audit trail is signed with a key held outside the database; refuse to
// start in production without one. Chains from before signing are sealed
// once, by hand, with `bun run audit:seal` (see audit-seal.ts for why).
configureAuditKeys(auditKeyringFromEnv({ ...process.env, NODE_ENV: env.NODE_ENV }));

const app = buildApp({
  db,
  env,
  logger: env.API_LOG,
  rateLimits: { passwordForgotPerHourPerAddress: env.AUTH_FORGOT_PER_HOUR },
});

await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Stop accepting connections and let in-flight requests finish before the
    // pool goes away, so a deploy doesn't turn into a burst of 500s.
    await app.close();
    // A failed sign-in is recorded just after its reply; let those land.
    await settleDeferredAccountEvents();
    await close();
    process.exit(0);
  });
}
