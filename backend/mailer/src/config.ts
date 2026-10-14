import { ConsoleMailer, type Mailer } from './mailer.ts';
import { SmtpMailer } from './smtp.ts';

export type MailEnv = {
  NODE_ENV?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  MAIL_FROM?: string;
};

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

  if (host) {
    const port = Number(env.SMTP_PORT ?? 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`SMTP_PORT must be a port number; got "${env.SMTP_PORT}".`);
    }
    if (env.SMTP_USER && !env.SMTP_PASS) {
      throw new Error('SMTP_USER is set but SMTP_PASS is not.');
    }
    return new SmtpMailer({
      host,
      port,
      secure: env.SMTP_SECURE === '1' || env.SMTP_SECURE?.toLowerCase() === 'true',
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASS || undefined,
      from: env.MAIL_FROM?.trim() || 'Robis <no-reply@localhost>',
    });
  }

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
