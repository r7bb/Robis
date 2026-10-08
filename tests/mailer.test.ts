import { describe, expect, test } from 'bun:test';
import { ConsoleMailer, MemoryMailer, passwordResetMail, verifyEmailMail } from '@robis/mailer';

/**
 * The mail port and its two drivers.
 *
 * There is no SMTP target on this machine, so the interesting property is that
 * the flows do not care: they take a `Mailer` and the driver decides where the
 * message goes. These tests pin the two drivers that exist -- one for reading
 * links during development, one for asserting in tests -- and the message
 * bodies, which are the only place a reset link is assembled.
 */

describe('MemoryMailer', () => {
  test('records what it was asked to send', async () => {
    const mailer = new MemoryMailer();

    await mailer.send({ to: 'ada@robis.test', subject: 'Hello', text: 'Body' });

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toEqual({ to: 'ada@robis.test', subject: 'Hello', text: 'Body' });
  });

  test('finds the most recent message for an address', async () => {
    const mailer = new MemoryMailer();

    await mailer.send({ to: 'ada@robis.test', subject: 'First', text: '1' });
    await mailer.send({ to: 'bob@robis.test', subject: 'Other', text: '2' });
    await mailer.send({ to: 'ada@robis.test', subject: 'Second', text: '3' });

    expect(mailer.lastTo('ada@robis.test')?.subject).toBe('Second');
    expect(mailer.lastTo('nobody@robis.test')).toBeUndefined();
  });

  /** Addresses are stored lowercased elsewhere; lookup should not be the odd one out. */
  test('address lookup ignores case', async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: 'ada@robis.test', subject: 'Hi', text: 'x' });

    expect(mailer.lastTo('ADA@robis.test')?.subject).toBe('Hi');
  });

  test('clear empties the record', async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: 'ada@robis.test', subject: 'Hi', text: 'x' });

    mailer.clear();
    expect(mailer.sent).toEqual([]);
  });

  /** A caller holding the list must not be able to rewrite history. */
  test('the exposed list is a copy', async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: 'ada@robis.test', subject: 'Hi', text: 'x' });

    mailer.sent.push({ to: 'forged@robis.test', subject: 'Forged', text: 'x' });

    expect(mailer.sent).toHaveLength(1);
  });
});

describe('ConsoleMailer', () => {
  test('writes the message somewhere a human can read it', async () => {
    const lines: string[] = [];
    const mailer = new ConsoleMailer((line) => lines.push(line));

    await mailer.send({
      to: 'ada@robis.test',
      subject: 'Reset your password',
      text: 'Open http://localhost:3000/reset-password?token=abc',
    });

    const output = lines.join('\n');
    expect(output).toContain('ada@robis.test');
    expect(output).toContain('Reset your password');
    // The link is the entire point of the dev driver.
    expect(output).toContain('http://localhost:3000/reset-password?token=abc');
  });
});

describe('message bodies', () => {
  const link = 'http://localhost:3000/reset-password?token=the-token';

  test('a reset message carries the link and says how long it lasts', () => {
    const mail = passwordResetMail('ada@robis.test', link, 30);

    expect(mail.to).toBe('ada@robis.test');
    expect(mail.subject).toMatch(/password/i);
    expect(mail.text).toContain(link);
    expect(mail.text).toContain('30 minutes');
  });

  /**
   * A reset mail goes to an address that may not have asked for it, so it has
   * to say that ignoring it is safe and that nothing has changed yet.
   */
  test('a reset message tells an unexpecting reader to ignore it', () => {
    const mail = passwordResetMail('ada@robis.test', link, 30);

    expect(mail.text).toMatch(/did ?n.t|ignore/i);
  });

  test('a verification message carries its link', () => {
    const verifyLink = 'http://localhost:3000/verify-email?token=abc';
    const mail = verifyEmailMail('ada@robis.test', verifyLink, 1440);

    expect(mail.to).toBe('ada@robis.test');
    expect(mail.subject).toMatch(/verif/i);
    expect(mail.text).toContain(verifyLink);
  });

  /** Minutes are not a useful unit for a day-long link. */
  test('durations read naturally in hours when long enough', () => {
    const mail = verifyEmailMail('ada@robis.test', 'http://x', 1440);
    expect(mail.text).toContain('24 hours');
  });
});
