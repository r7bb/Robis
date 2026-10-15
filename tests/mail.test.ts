import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import {
  claimJobs,
  deadLetterCount,
  jobs,
  MAIL_EMAIL_VERIFICATION_JOB,
  MAIL_JOBS,
  MAIL_PASSWORD_RESET_JOB,
} from '@robis/database';
import {
  mailerFromEnv,
  passwordResetMail,
  SmtpMailer,
  type SmtpOptions,
  SmtpSendError,
  verifyEmailMail,
} from '@robis/mailer';
import { mailHandlers, mailOriginFromEnv } from '@robis/worker/mail';
import { Runner } from '@robis/worker/runner';
import { eq } from 'drizzle-orm';
import { type MailSink, parseMessage, startMailSink } from '../scripts/mail/sink-server.ts';
import { closeHarness, createActor, getHarness, request, resetDatabase } from './harness.ts';

/**
 * Real mail, through the real driver.
 *
 * The rest of the suite reads mail from the memory driver. This file sends
 * it over SMTP to the local sink, so the path a deployment uses -- API queues,
 * worker issues the link, nodemailer speaks SMTP -- is exercised end to end.
 */

const WEB_ORIGIN = 'http://localhost:3000';
const NEW_PASSWORD = 'a-completely-different-password';

let sink: MailSink;

beforeAll(async () => {
  sink = await startMailSink();
});
afterAll(async () => {
  await sink.close();
  await closeHarness();
});
beforeEach(async () => {
  await resetDatabase();
  sink.messages.length = 0;
});

const smtpTo = (port: number): SmtpOptions => ({
  host: '127.0.0.1',
  port,
  secure: false,
  from: 'Robis <no-reply@robis.test>',
});

async function mailWorker(port: number) {
  const { db } = await getHarness();
  return new Runner({
    db,
    handlers: mailHandlers({ mailer: new SmtpMailer(smtpTo(port)), webOrigin: WEB_ORIGIN }),
    kinds: MAIL_JOBS,
  });
}

/** A port with nothing listening on it, so every connection is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('a reset email over SMTP', () => {
  test('lands in the sink with a link that resets the password', async () => {
    const actor = await createActor('Holder');

    const asked = await request('/auth/password/forgot', {
      method: 'POST',
      payload: { email: actor.email },
    });
    expect(asked.statusCode).toBe(202);

    const result = await (await mailWorker(sink.port)).tick();
    expect(result.failed).toBe(0);

    const mail = sink.lastTo(actor.email);
    expect(mail?.subject).toBe('Reset your Robis password');

    // The link as the person would click it: the configured origin, the
    // reset page, and a token the API accepts once.
    const linkText = /https?:\/\/\S+/.exec(mail!.text)?.[0];
    const link = new URL(linkText!);
    expect(link.origin).toBe(WEB_ORIGIN);
    expect(link.pathname).toBe('/reset-password');

    const reset = await request('/auth/password/reset', {
      method: 'POST',
      payload: { token: link.searchParams.get('token'), newPassword: NEW_PASSWORD },
    });
    expect(reset.statusCode).toBe(200);

    const login = await request('/auth/login', {
      method: 'POST',
      payload: { email: actor.email, password: NEW_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  test('the job holds only the account id, never the link', async () => {
    const actor = await createActor('Holder');
    await request('/auth/password/forgot', { method: 'POST', payload: { email: actor.email } });

    const { db } = await getHarness();
    const [job] = await db.select().from(jobs).where(eq(jobs.kind, MAIL_PASSWORD_RESET_JOB));
    expect(JSON.parse(job!.payload)).toEqual({ userId: actor.id });
  });
});

describe('a mail server that is down', () => {
  test('retries with backoff, then keeps the job as a dead letter', async () => {
    const actor = await createActor('Holder');
    await request('/auth/password/forgot', { method: 'POST', payload: { email: actor.email } });

    const { db } = await getHarness();
    const worker = await mailWorker(await closedPort());
    const resetJob = eq(jobs.kind, MAIL_PASSWORD_RESET_JOB);

    const first = await worker.tick();
    expect(first.failed).toBeGreaterThan(0);
    const [retrying] = await db.select().from(jobs).where(resetJob);
    expect(retrying!.runAt.getTime()).toBeGreaterThan(Date.now());

    // Make each backoff due now rather than wait it out.
    for (let attempt = 0; attempt < 15; attempt++) {
      await db.update(jobs).set({ runAt: new Date() }).where(resetJob);
      if ((await worker.tick()).dead > 0) break;
    }

    expect(await deadLetterCount(db)).toBeGreaterThan(0);
    const [dead] = await db.select().from(jobs).where(resetJob);
    expect(dead!.attempts).toBe(dead!.maxAttempts);
    expect(sink.messages).toEqual([]);
    // What was recorded names the failure, not the server's words.
    expect(dead!.lastError).toMatch(/^SMTP send failed/);
    expect(dead!.lastError).not.toContain(actor.email);
  });
});

describe('one waiting email per account', () => {
  test('asking twice before it is sent queues one reset', async () => {
    const actor = await createActor('Holder');
    for (let i = 0; i < 2; i++) {
      await request('/auth/password/forgot', { method: 'POST', payload: { email: actor.email } });
    }

    const { db } = await getHarness();
    const queued = await db.select().from(jobs).where(eq(jobs.kind, MAIL_PASSWORD_RESET_JOB));
    expect(queued).toHaveLength(1);
  });

  test('resending while the first is waiting queues nothing new', async () => {
    const actor = await createActor('Holder');
    // Sign-up already queued one; the button adds nothing until it is sent.
    for (let i = 0; i < 3; i++) {
      expect((await request('/auth/email/resend', { method: 'POST', actor })).statusCode).toBe(200);
    }

    const { db } = await getHarness();
    const queued = await db.select().from(jobs).where(eq(jobs.kind, MAIL_EMAIL_VERIFICATION_JOB));
    expect(queued).toHaveLength(1);
  });

  test('once one is sent, the next request queues again', async () => {
    const actor = await createActor('Holder');
    const forgot = () =>
      request('/auth/password/forgot', { method: 'POST', payload: { email: actor.email } });

    await forgot();
    await (await mailWorker(sink.port)).tick();
    await forgot();

    const { db } = await getHarness();
    const queued = await db.select().from(jobs).where(eq(jobs.kind, MAIL_PASSWORD_RESET_JOB));
    expect(queued).toHaveLength(1);
    expect(sink.messages.filter((m) => m.subject.startsWith('Reset'))).toHaveLength(1);
  });

  test('asking for no kinds claims nothing', async () => {
    const { db } = await getHarness();
    await createActor('Holder');
    expect(await claimJobs(db, 'test', 5, new Date(), [])).toEqual([]);
  });
});

describe('configuration', () => {
  test('production refuses to start with no mail driver configured', () => {
    expect(() => mailerFromEnv({ NODE_ENV: 'production' })).toThrow(
      /no production mail driver is configured/,
    );
  });

  test('production with SMTP configured gets the SMTP driver', () => {
    const mailer = mailerFromEnv({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example.com' });
    expect(mailer).toBeInstanceOf(SmtpMailer);
  });

  test('a user without a password is refused', () => {
    expect(() => mailerFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'robis' })).toThrow(
      /SMTP_PASS/,
    );
  });

  test('TLS is required for any server but this machine', () => {
    const requireTLS = (host: string) =>
      (
        new SmtpMailer({ ...smtpTo(587), host }) as unknown as {
          transport: { options: { requireTLS?: boolean } };
        }
      ).transport.options.requireTLS;

    expect(requireTLS('smtp.example.com')).toBe(true);
    expect(requireTLS('127.0.0.1')).toBe(false);
    expect(requireTLS('localhost')).toBe(false);
  });

  test('plain SMTP to another host is a development-only opt-out', () => {
    const plain = mailerFromEnv({
      NODE_ENV: 'development',
      SMTP_HOST: 'mail',
      SMTP_REQUIRE_TLS: '0',
    }) as unknown as {
      transport: { options: { requireTLS?: boolean } };
    };
    expect(plain.transport.options.requireTLS).toBe(false);
    for (const NODE_ENV of ['production', 'staging', 'Production', undefined]) {
      expect(() => mailerFromEnv({ NODE_ENV, SMTP_HOST: 'mail', SMTP_REQUIRE_TLS: '0' })).toThrow(
        /refused outside development/,
      );
    }
    expect(() =>
      mailerFromEnv({
        NODE_ENV: 'development',
        SMTP_HOST: 'mail',
        SMTP_REQUIRE_TLS: '0',
        SMTP_USER: 'robis',
        SMTP_PASS: 'secret',
      }),
    ).toThrow(/SMTP_USER/);
  });

  test('a send error keeps the code and drops the reply text', () => {
    const error = new SmtpSendError(
      Object.assign(new Error('550 5.1.1 <victim@robis.test>: user unknown'), {
        code: 'EENVELOPE',
        responseCode: 550,
        command: 'RCPT TO',
      }),
    );
    expect(error.message).toBe('SMTP send failed: EENVELOPE 550 RCPT TO');
  });

  test('a port that is not a port is refused', () => {
    expect(() => mailerFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: 'twenty' })).toThrow(
      /SMTP_PORT/,
    );
  });

  test('mailed links must be https in production', () => {
    expect(() =>
      mailOriginFromEnv({ NODE_ENV: 'production', WEB_ORIGIN: 'http://robis.example' }),
    ).toThrow(/https/);
    expect(
      mailOriginFromEnv({ NODE_ENV: 'production', WEB_ORIGIN: 'https://robis.example/' }),
    ).toBe('https://robis.example');
  });
});

describe('messages', () => {
  test('every message Robis sends has a plain-text body', () => {
    for (const mail of [
      passwordResetMail('a@robis.test', `${WEB_ORIGIN}/reset-password?token=t`, 30),
      verifyEmailMail('a@robis.test', `${WEB_ORIGIN}/verify-email?token=t`, 1440),
    ]) {
      expect(mail.text.length).toBeGreaterThan(0);
      expect(mail.text).toContain(WEB_ORIGIN);
    }
  });

  test('the sink decodes quoted-printable and encoded subjects', () => {
    const raw = [
      'Subject: =?UTF-8?Q?R=C3=A9initia?=',
      ' =?UTF-8?Q?liser?=',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'caf=C3=A9 and a long line that was so=',
      'ft-wrapped',
    ].join('\r\n');
    expect(parseMessage(raw)).toEqual({
      subject: 'Réinitialiser',
      text: 'café and a long line that was soft-wrapped',
    });
  });
});
