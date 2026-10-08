/**
 * The mail port.
 *
 * There is no SMTP service reachable from this machine, which is exactly why
 * sending is a port rather than a call to a provider: the flows that send mail
 * depend on this one function, and the driver decides whether the message goes
 * to a terminal, to a test, or one day to a real robis.
 *
 * Adding SMTP means one more driver wrapping `nodemailer` and a line of
 * configuration. It is deliberately not here yet -- a dependency that cannot
 * be exercised is a dependency that cannot be trusted.
 */

export type Mail = {
  /** A single recipient. Fan-out is the caller's business, not the port's. */
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send(mail: Mail): Promise<void>;
};

/**
 * Writes mail where a developer will see it.
 *
 * The default for local work, and the whole point is the link in the body: a
 * reset flow cannot be exercised by hand if the token only ever exists in a
 * database row, so this prints the message and the link is clickable from the
 * terminal.
 *
 * The sink is injectable so this driver can be tested without capturing
 * `console`, which is global state shared with every other test in the run.
 */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(mail: Mail): Promise<void> {
    this.log(
      [
        '',
        '  --- mail ------------------------------------------',
        `  to:      ${mail.to}`,
        `  subject: ${mail.subject}`,
        '  ---------------------------------------------------',
        ...mail.text.split('\n').map((line) => `  ${line}`),
        '  ---------------------------------------------------',
        '',
      ].join('\n'),
    );
  }
}

/**
 * Records mail instead of sending it, for tests.
 *
 * Tests need the token that was mailed, and reading it out of the message body
 * is the honest way to get it: it proves the address received something it can
 * actually act on, rather than asserting against a row the user never saw.
 */
export class MemoryMailer implements Mailer {
  private readonly messages: Mail[] = [];

  async send(mail: Mail): Promise<void> {
    this.messages.push(mail);
  }

  /** A copy, so a caller holding the list cannot rewrite what was sent. */
  get sent(): Mail[] {
    return [...this.messages];
  }

  /**
   * The most recent message for an address, matched case-insensitively.
   *
   * `findLast` would read better but needs an ES2023 lib target, and raising
   * it across the monorepo for one method on a test double is not a trade
   * worth making. The extra array is free at this size.
   */
  lastTo(address: string): Mail | undefined {
    const wanted = address.toLowerCase();
    const matches = this.messages.filter((message) => message.to.toLowerCase() === wanted);
    return matches[matches.length - 1];
  }

  clear(): void {
    this.messages.length = 0;
  }
}
