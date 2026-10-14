import { createTransport, type Transporter } from 'nodemailer';
import type { Mail, Mailer } from './mailer.ts';

export type SmtpOptions = {
  host: string;
  port: number;
  /** TLS from the first byte (port 465). Otherwise STARTTLS is used when offered. */
  secure: boolean;
  user?: string;
  pass?: string;
  /** The From header, e.g. `Robis <no-reply@example.com>`. */
  from: string;
};

/** Long enough for a slow provider, short enough that a dead one fails the job. */
const TIMEOUT_MS = 15_000;

/**
 * The whole send, end to end. Under the queue's 60-second visibility timeout,
 * so a slow send fails here before another worker can reclaim the job and
 * mail a second link that replaces the first.
 */
const SEND_BUDGET_MS = 45_000;

/** A local server (the dev sink) may speak plain SMTP; anything else must not. */
function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

/**
 * What a failed send records: the SMTP code and command, never the server's
 * reply text, which can quote the recipient's address back. Failures end up
 * in the jobs table, and a dead letter keeps them.
 */
export class SmtpSendError extends Error {
  constructor(cause: unknown) {
    const { code, responseCode, command } = (cause ?? {}) as {
      code?: string;
      responseCode?: number;
      command?: string;
    };
    const detail = [code, responseCode, command].filter((part) => part !== undefined).join(' ');
    super(`SMTP send failed${detail ? `: ${detail}` : ''}`);
    this.name = 'SmtpSendError';
  }
}

/**
 * Real mail, over SMTP, through `nodemailer`.
 *
 * Plain text only, which every client renders and no spam filter penalises
 * by itself. Nothing here promises delivery: SMTP accepting a message means
 * the next server has it, not that a person will see it.
 *
 * Errors are thrown, not swallowed. Mail is sent from the job queue, and a
 * failure there is retried with backoff and, after the last attempt, kept as
 * a dead letter someone can look at.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(private readonly options: SmtpOptions) {
    this.transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      // Without this, a server (or anyone in the path) that leaves STARTTLS
      // out of its greeting gets the password and the reset links in clear.
      requireTLS: !options.secure && !isLoopback(options.host),
      auth: options.user ? { user: options.user, pass: options.pass ?? '' } : undefined,
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
  }

  async send(mail: Mail): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })),
        SEND_BUDGET_MS,
      );
    });

    try {
      await Promise.race([
        this.transport.sendMail({
          from: this.options.from,
          to: mail.to,
          subject: mail.subject,
          text: mail.text,
        }),
        budget,
      ]);
    } catch (error) {
      throw new SmtpSendError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}
