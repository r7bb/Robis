import { createDatabase } from '@robis/database';
import { ConsoleMailer, type Mailer } from '@robis/mailer';
import { buildApp } from './app.ts';
import { loadEnv } from './env.ts';

const env = loadEnv();
const { db, close } = createDatabase(env.DATABASE_URL, { max: env.DB_POOL_MAX });

/**
 * Pick a mail driver, and refuse to start rather than pick a dangerous one.
 *
 * The only driver that exists is the console one, which prints the message
 * body -- including a live password-reset link -- to stdout. That is exactly
 * what you want locally and catastrophic in production: nobody receives a
 * reset mail, and anybody who can read the logs can take over any account by
 * requesting a reset for its address.
 *
 * So production is a hard stop. Failing at startup with an explanation beats
 * booting into a system whose recovery flow is a credential leak, and it keeps
 * the missing piece visible instead of implied.
 */
function resolveMailer(): Mailer {
  if (env.NODE_ENV !== 'production') return new ConsoleMailer();

  throw new Error(
    [
      'Refusing to start: no production mail driver is configured.',
      '',
      'Robis ships only ConsoleMailer, which writes password-reset links to',
      'stdout. In production that means no user receives a link, and anyone',
      'with log access can take over any account.',
      '',
      'Add an SMTP (or provider) driver implementing the Mailer port in',
      'backend/mailer and pass it to buildApp before deploying.',
    ].join('\n'),
  );
}

const app = buildApp({
  db,
  env,
  logger: env.API_LOG,
  mailer: resolveMailer(),
  rateLimits: { passwordForgotPerHourPerAddress: env.AUTH_FORGOT_PER_HOUR },
});

await app.listen({ port: env.API_PORT, host: env.API_HOST });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    // Stop accepting connections and let in-flight requests finish before the
    // pool goes away, so a deploy doesn't turn into a burst of 500s.
    await app.close();
    await close();
    process.exit(0);
  });
}
