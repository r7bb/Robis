import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';

/**
 * A local mail sink: an SMTP server that keeps what it receives.
 *
 * For development and tests only. It accepts any sender and recipient,
 * without TLS or a password, on the loopback interface, and stores messages
 * in memory. Nothing it receives goes anywhere else.
 */
export type SunkMessage = {
  id: number;
  receivedAt: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
};

export type MailSink = {
  port: number;
  messages: SunkMessage[];
  /** The newest message addressed to `address`, if any. */
  lastTo: (address: string) => SunkMessage | undefined;
  close: () => Promise<void>;
};

/** A dev sink, not an archive: the oldest messages are dropped past this. */
const KEEP_MESSAGES = 200;
const MAX_MESSAGE_BYTES = 1024 * 1024;

/** Split a raw message into unfolded headers and its body. */
function splitMessage(raw: string): { headers: Map<string, string>; body: string } {
  const normalised = raw.replace(/\r\n/g, '\n');
  const gap = normalised.indexOf('\n\n');
  const head = gap === -1 ? normalised : normalised.slice(0, gap);
  const body = gap === -1 ? '' : normalised.slice(gap + 2);

  const headers = new Map<string, string>();
  for (const line of head.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return { headers, body };
}

function decodeQuotedPrintable(text: string): string {
  const joined = text.replace(/=\n/g, '');
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex = joined.slice(i + 1, i + 3);
    if (joined[i] === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(...encoder.encode(joined[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeBody(body: string, encoding: string | undefined): string {
  switch (encoding?.toLowerCase()) {
    case 'quoted-printable':
      return decodeQuotedPrintable(body);
    case 'base64':
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    default:
      return body;
  }
}

/** RFC 2047 encoded words, which nodemailer uses for a non-ASCII subject. */
function decodeHeader(value: string): string {
  // Whitespace between two encoded words is folding, not text (RFC 2047 6.2).
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([QB])\?([^?]*)\?=/gi, (_match, _charset, kind, data) =>
      kind.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64').toString('utf8')
        : decodeQuotedPrintable(data.replace(/_/g, ' ')),
    );
}

/** The subject and plain-text body of a single-part message. */
export function parseMessage(raw: string) {
  const { headers, body } = splitMessage(raw);
  return {
    subject: decodeHeader(headers.get('subject') ?? ''),
    text: decodeBody(body, headers.get('content-transfer-encoding')).replace(/\n$/, ''),
  };
}

export async function startMailSink(options: { port?: number } = {}): Promise<MailSink> {
  const messages: SunkMessage[] = [];
  let nextId = 1;

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    size: MAX_MESSAGE_BYTES,
    logger: false,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', callback);
      stream.on('end', () => {
        if (stream.sizeExceeded) {
          callback(Object.assign(new Error('Message too large'), { responseCode: 552 }));
          return;
        }
        const { subject, text } = parseMessage(Buffer.concat(chunks).toString('utf8'));
        const from = session.envelope.mailFrom;
        messages.push({
          id: nextId++,
          receivedAt: new Date().toISOString(),
          from: from ? from.address : '',
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          subject,
          text,
        });
        if (messages.length > KEEP_MESSAGES) messages.shift();
        callback();
      });
    },
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Loopback only: this accepts mail from anyone who can reach it.
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });

  const { port } = server.server.address() as AddressInfo;

  return {
    port,
    messages,
    lastTo: (to) => [...messages].reverse().find((message) => message.to.includes(to)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
