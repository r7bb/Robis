import { ConsoleMailer, type Mailer } from './mailer.ts';
import { SmtpMailer, type SmtpOptions } from './smtp.ts';

export type MailEnv = {
  NODE_ENV?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_REQUIRE_TLS?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM?: string;
};

/** SMTP settings from the environment, refusing any that cannot work or are unsafe. */
function smtpOptionsFromEnv(env: MailEnv, host: string): SmtpOptions {
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT must be a port number; got "${env.SMTP_PORT}".`);
  }
  if (env.SMTP_USER && !env.SMTP_PASS) {
    throw new Error('SMTP_USER is set but SMTP_PASS is not.');
  }
  const allowPlaintext = env.SMTP_REQUIRE_TLS === '0';
  // Allowed by name, not refused by name: "prod", "staging" or a typo must
  // not slip through. And never with a password, which would cross in clear.
  const localEnv = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  if (allowPlaintext && (!localEnv || env.SMTP_USER)) {
    throw new Error(
      'SMTP_REQUIRE_TLS=0 is refused outside development and test, and with SMTP_USER set: mail would carry live links and the password in clear.',
    );
  }
  return {
    host,
    port,
    secure: env.SMTP_SECURE === '1' || env.SMTP_SECURE?.toLowerCase() === 'true',
    requireTLS: allowPlaintext ? false : undefined,
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    from: env.MAIL_FROM?.trim() || 'Robis <no-reply@localhost>',
  };
}

/**
 * The mail driver the environment asks for.
 *
 * SMTP when `SMTP_HOST` is set; otherwise the console driver, which prints
 * messages (links included) where a developer will see them. In production
 * the console driver is refused outright: nobody would receive a reset link,
 * and anyone who can read the logs could use one.
 */
export function mailerFromEnv(env: MailEnv): Mailer {
  const host = env.SMTP_HOST?.trim();
  if (host) return new SmtpMailer(smtpOptionsFromEnv(env, host));

  if (env.NODE_ENV === 'production') {
    throw new Error(
      [
        'Refusing to start: no production mail driver is configured.',
        '',
        'Set SMTP_HOST (and SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM as your',
        'provider needs). Without one, password-reset links would be written to',
        'the logs instead of reaching anyone.',
      ].join('\n'),
    );
  }

  return new ConsoleMailer();
}
